// ResellerService backs the reseller feature: a scoped sub-account that can
// create and manage only its own clients (locked to one group and a fixed
// set of inbounds) up to a traffic-volume quota the admin grants. It does
// not reimplement client management — every client operation here forces
// ownership (Group/inbound) and then delegates to ClientService, so a
// reseller can never do anything an admin-created client couldn't already do.
package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/mhsanaei/3x-ui/v3/internal/database"
	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
	"github.com/mhsanaei/3x-ui/v3/internal/util/crypto"
	"github.com/mhsanaei/3x-ui/v3/internal/xray"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrResellerForbidden is returned when a reseller targets an inbound or a
// client outside its own scope.
var ErrResellerForbidden = errors.New("not allowed for this reseller")

// ErrResellerQuotaExceeded is returned when a create would push UsedBytes
// past QuotaBytes.
var ErrResellerQuotaExceeded = errors.New("traffic quota exceeded")

// resellerDeleteGraceMillis is the window, from a client's CreatedAt, within
// which an unused client's totalGB is credited back to the reseller's quota
// on delete. Past this window — or with any recorded up/down — the quota
// charge is permanent, matching a real sale.
const resellerDeleteGraceMillis = 30 * 60 * 1000

type ResellerService struct {
	clientService ClientService
}

func hashResellerApiKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func generateResellerApiKey() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "rk_" + hex.EncodeToString(buf), nil
}

// ---------------------------------------------------------------------
// Admin-facing CRUD (used by the "Resellers" management page)
// ---------------------------------------------------------------------

// ResellerCreatePayload is the admin-supplied shape for creating a reseller.
type ResellerCreatePayload struct {
	Username          string `json:"username"`
	Password          string `json:"password"`
	GroupName         string `json:"groupName"`
	AllowedInboundIds []int  `json:"allowedInboundIds"`
	QuotaBytes        int64  `json:"quotaBytes"`
}

// Create adds a reseller and returns the plaintext API key. The key is never
// stored or retrievable again — only its hash is — so this is the one moment
// the admin can copy it for the reseller's bot.
func (s *ResellerService) Create(payload ResellerCreatePayload) (*model.Reseller, string, error) {
	if payload.Username == "" || payload.Password == "" || payload.GroupName == "" {
		return nil, "", errors.New("username, password and groupName are required")
	}
	if payload.QuotaBytes < 0 {
		payload.QuotaBytes = 0
	}
	pwHash, err := crypto.HashPasswordAsBcrypt(payload.Password)
	if err != nil {
		return nil, "", err
	}
	apiKey, err := generateResellerApiKey()
	if err != nil {
		return nil, "", err
	}
	r := &model.Reseller{
		Username:          payload.Username,
		PasswordHash:      pwHash,
		ApiKeyHash:        hashResellerApiKey(apiKey),
		GroupName:         payload.GroupName,
		AllowedInboundIds: payload.AllowedInboundIds,
		QuotaBytes:        payload.QuotaBytes,
		Enabled:           true,
	}
	if err := database.GetDB().Create(r).Error; err != nil {
		return nil, "", err
	}
	return r, apiKey, nil
}

// List returns every reseller, for the admin management page.
func (s *ResellerService) List() ([]model.Reseller, error) {
	var rows []model.Reseller
	err := database.GetDB().Order("id asc").Find(&rows).Error
	return rows, err
}

// Get returns one reseller by id.
func (s *ResellerService) Get(id int) (*model.Reseller, error) {
	var r model.Reseller
	if err := database.GetDB().First(&r, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

// ResellerUpdatePayload edits an existing reseller. Username and GroupName
// are immutable after creation — both are load-bearing identifiers (login
// name; ownership boundary for every client already created under it) — so
// changing either would silently orphan existing clients or break the
// reseller's bot/login. Delete and recreate instead.
type ResellerUpdatePayload struct {
	Password          *string `json:"password"`
	AllowedInboundIds *[]int  `json:"allowedInboundIds"`
	QuotaBytes        *int64  `json:"quotaBytes"`
	Enabled           *bool   `json:"enabled"`
}

// Update applies a partial edit. Loaded-then-saved (rather than a column-map
// update) so the AllowedInboundIds JSON serializer is honored correctly.
func (s *ResellerService) Update(id int, payload ResellerUpdatePayload) (*model.Reseller, error) {
	db := database.GetDB()
	var r model.Reseller
	if err := db.First(&r, "id = ?", id).Error; err != nil {
		return nil, err
	}
	if payload.Password != nil && *payload.Password != "" {
		h, err := crypto.HashPasswordAsBcrypt(*payload.Password)
		if err != nil {
			return nil, err
		}
		r.PasswordHash = h
	}
	if payload.AllowedInboundIds != nil {
		r.AllowedInboundIds = *payload.AllowedInboundIds
	}
	if payload.QuotaBytes != nil {
		q := *payload.QuotaBytes
		if q < 0 {
			q = 0
		}
		r.QuotaBytes = q
	}
	if payload.Enabled != nil {
		r.Enabled = *payload.Enabled
	}
	if err := db.Save(&r).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

// RegenerateApiKey issues a new bot API key and invalidates the old one
// immediately (old key stops matching as soon as the hash is overwritten).
func (s *ResellerService) RegenerateApiKey(id int) (string, error) {
	apiKey, err := generateResellerApiKey()
	if err != nil {
		return "", err
	}
	res := database.GetDB().Model(&model.Reseller{}).Where("id = ?", id).
		UpdateColumn("api_key_hash", hashResellerApiKey(apiKey))
	if res.Error != nil {
		return "", res.Error
	}
	if res.RowsAffected == 0 {
		return "", gorm.ErrRecordNotFound
	}
	return apiKey, nil
}

// Delete removes a reseller account. It intentionally does NOT touch that
// reseller's clients — they keep serving traffic under their group; the
// admin still sees and controls them in the main clients page like any other
// group. Deleting the reseller only revokes the bot/web access, nothing more.
func (s *ResellerService) Delete(id int) error {
	return database.GetDB().Delete(&model.Reseller{}, "id = ?", id).Error
}

// ---------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------

// Authenticate checks a reseller's web-login username/password.
func (s *ResellerService) Authenticate(username, password string) (*model.Reseller, error) {
	var r model.Reseller
	if err := database.GetDB().First(&r, "username = ?", username).Error; err != nil {
		return nil, errors.New("invalid credentials")
	}
	if !r.Enabled {
		return nil, errors.New("account disabled")
	}
	if !crypto.CheckPasswordHash(r.PasswordHash, password) {
		return nil, errors.New("invalid credentials")
	}
	return &r, nil
}

// MatchApiKey resolves a bot-presented bearer key to its reseller. Disabled
// accounts never match, exactly like a bad key.
func (s *ResellerService) MatchApiKey(key string) (*model.Reseller, bool) {
	var r model.Reseller
	if err := database.GetDB().First(&r, "api_key_hash = ?", hashResellerApiKey(key)).Error; err != nil {
		return nil, false
	}
	if !r.Enabled {
		return nil, false
	}
	return &r, true
}

// ---------------------------------------------------------------------
// Scoped client operations — the reseller-facing surface
// ---------------------------------------------------------------------

func inboundAllowed(r *model.Reseller, inboundId int) bool {
	for _, id := range r.AllowedInboundIds {
		if id == inboundId {
			return true
		}
	}
	return false
}

// ownClientOrForbidden loads a client by email and confirms it belongs to
// this reseller's group before any mutating call is allowed to touch it.
func (s *ResellerService) ownClientOrForbidden(r *model.Reseller, email string) (*model.ClientRecord, error) {
	rec, err := s.clientService.GetRecordByEmail(nil, email)
	if err != nil {
		return nil, err
	}
	if rec.Group != r.GroupName {
		return nil, ErrResellerForbidden
	}
	return rec, nil
}

// CreateClient creates a client on one of the reseller's allowed inbounds. It
// forces the client onto the reseller's own group — whatever group the
// request claims is ignored — and debits QuotaBytes by TotalGB inside a
// row-locked transaction, so two near-simultaneous creates from the same
// reseller cannot both slip under a nearly-exhausted quota. If the
// downstream client creation then fails, the debit is reversed.
func (s *ResellerService) CreateClient(inboundSvc *InboundService, r *model.Reseller, inboundId int, client model.Client) (bool, error) {
	if !inboundAllowed(r, inboundId) {
		return false, ErrResellerForbidden
	}
	if client.TotalGB < 0 {
		client.TotalGB = 0
	}
	client.Group = r.GroupName

	db := database.GetDB()
	if err := db.Transaction(func(tx *gorm.DB) error {
		var fresh model.Reseller
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&fresh, "id = ?", r.Id).Error; err != nil {
			return err
		}
		if !fresh.Enabled {
			return ErrResellerForbidden
		}
		if fresh.UsedBytes+client.TotalGB > fresh.QuotaBytes {
			return ErrResellerQuotaExceeded
		}
		return tx.Model(&model.Reseller{}).Where("id = ?", fresh.Id).
			UpdateColumn("used_bytes", fresh.UsedBytes+client.TotalGB).Error
	}); err != nil {
		return false, err
	}

	created, err := s.clientService.CreateOne(inboundSvc, inboundId, client)
	if err != nil || !created {
		// The debit already landed; the create didn't. Give the volume back.
		database.GetDB().Model(&model.Reseller{}).Where("id = ?", r.Id).
			UpdateColumn("used_bytes", gorm.Expr("used_bytes - ?", client.TotalGB))
		return created, err
	}
	return true, nil
}

// UpdateClient edits one of the reseller's own clients. Group and inboundId
// are not settable through this path — Group always stays the reseller's
// own, and moving a client to a different inbound is an inbound-management
// action the reseller doesn't have.
func (s *ResellerService) UpdateClient(inboundSvc *InboundService, r *model.Reseller, email string, updated model.Client, limitHwid int) (bool, error) {
	if _, err := s.ownClientOrForbidden(r, email); err != nil {
		return false, err
	}
	updated.Group = r.GroupName
	return s.clientService.UpdateByEmail(inboundSvc, email, updated, limitHwid)
}

// SetClientEnable toggles one of the reseller's own clients.
func (s *ResellerService) SetClientEnable(inboundSvc *InboundService, r *model.Reseller, email string, enable bool) (bool, error) {
	if _, err := s.ownClientOrForbidden(r, email); err != nil {
		return false, err
	}
	_, ok, err := s.clientService.BulkSetEnable(inboundSvc, []string{email}, enable)
	return ok, err
}

// ResetClientTraffic resets usage on one of the reseller's own clients. This
// never touches the quota ledger — the ledger tracks sold volume, not
// consumption.
func (s *ResellerService) ResetClientTraffic(inboundSvc *InboundService, r *model.Reseller, email string) (bool, error) {
	if _, err := s.ownClientOrForbidden(r, email); err != nil {
		return false, err
	}
	return s.clientService.ResetTrafficByEmail(inboundSvc, email)
}

// DeleteClient deletes one of the reseller's own clients. Within
// resellerDeleteGraceMillis of creation, and only if it never carried any
// traffic, the client's TotalGB is credited back to QuotaBytes — an
// unmistakable mis-click, not a used sale. Any later delete, or one with
// recorded up/down, leaves the ledger exactly where it was.
func (s *ResellerService) DeleteClient(inboundSvc *InboundService, r *model.Reseller, email string) (bool, error) {
	rec, err := s.ownClientOrForbidden(r, email)
	if err != nil {
		return false, err
	}

	deleted, err := s.clientService.DeleteByEmail(inboundSvc, email, false)
	if err != nil || !deleted {
		return deleted, err
	}

	age := time.Now().UnixMilli() - rec.CreatedAt
	if age >= 0 && age <= resellerDeleteGraceMillis && rec.TotalGB > 0 {
		var traffic xray.ClientTraffic
		err := database.GetDB().Where("email = ?", email).First(&traffic).Error
		if err == nil && traffic.Up == 0 && traffic.Down == 0 {
			database.GetDB().Model(&model.Reseller{}).Where("id = ?", r.Id).
				UpdateColumn("used_bytes", gorm.Expr(database.GreatestExpr("used_bytes - ?", "0"), rec.TotalGB))
		}
	}
	return true, nil
}

// ListParams mirrors the fields of the reseller's own ClientPageParams that
// are safe to accept from the reseller (see controller): Group and Filter
// are always overridden by the caller to the reseller's own group.
func (s *ResellerService) ListClients(inboundSvc *InboundService, settingSvc *SettingService, r *model.Reseller, params ClientPageParams) (*ClientPageResponse, error) {
	params.Group = r.GroupName
	return s.clientService.ListPaged(inboundSvc, settingSvc, params)
}
