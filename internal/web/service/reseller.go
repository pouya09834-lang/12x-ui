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
	"strings"
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
// which a client that has never been online has its traffic limit credited
// back to the reseller's quota when it is deleted (a mistake made at creation).
// Past this window - or once the client has connected even once - the quota
// charge is permanent, matching a real sale. Change this one constant to make
// the window longer or shorter.
const resellerDeleteGraceMillis = 10 * 60 * 1000

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
	Username          string  `json:"username"`
	Password          string  `json:"password"`
	GroupName         string  `json:"groupName"`
	AllowedInboundIds []int   `json:"allowedInboundIds"`
	QuotaBytes        int64   `json:"quotaBytes"`
	TrafficRatio      float64 `json:"trafficRatio"`
}

// normalizeRatio maps an unset/invalid ratio to the neutral 1.
func normalizeRatio(v float64) float64 {
	if v <= 0 {
		return 1
	}
	return v
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
		TrafficRatio:      normalizeRatio(payload.TrafficRatio),
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
	Password          *string  `json:"password"`
	AllowedInboundIds *[]int   `json:"allowedInboundIds"`
	QuotaBytes        *int64   `json:"quotaBytes"`
	Enabled           *bool    `json:"enabled"`
	TrafficRatio      *float64 `json:"trafficRatio"`
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
	if payload.TrafficRatio != nil {
		r.TrafficRatio = normalizeRatio(*payload.TrafficRatio)
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

// debit charges amount bytes against the reseller's quota inside a
// row-locked transaction, so two near-simultaneous requests cannot both slip
// under a nearly-exhausted quota.
func (s *ResellerService) debit(id int, amount int64) error {
	if amount <= 0 {
		return nil
	}
	return database.GetDB().Transaction(func(tx *gorm.DB) error {
		var fresh model.Reseller
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&fresh, "id = ?", id).Error; err != nil {
			return err
		}
		if !fresh.Enabled {
			return ErrResellerForbidden
		}
		if fresh.UsedBytes+amount > fresh.QuotaBytes {
			return ErrResellerQuotaExceeded
		}
		return tx.Model(&model.Reseller{}).Where("id = ?", fresh.Id).
			UpdateColumn("used_bytes", fresh.UsedBytes+amount).Error
	})
}

// credit gives amount bytes back to the reseller's quota (never below zero).
func (s *ResellerService) credit(id int, amount int64) {
	if amount <= 0 {
		return
	}
	database.GetDB().Model(&model.Reseller{}).Where("id = ?", id).
		UpdateColumn("used_bytes", gorm.Expr(database.GreatestExpr("used_bytes - ?", "0"), amount))
}

// ErrResellerTrafficRequired is returned when a reseller tries to create or
// leave a client without a traffic limit: an unlimited client would consume
// no quota at all, so it would bypass the volume ledger entirely.
var ErrResellerTrafficRequired = errors.New("a traffic limit greater than 0 is required")

// ErrResellerLimitDecrease is returned when an edit would lower a client's
// traffic limit. Volume already sold is never refunded by editing, so the
// limit can only go up (the difference is charged to the quota).
var ErrResellerLimitDecrease = errors.New("the traffic limit can only be increased")

// ErrResellerInboundRequired is returned when an edit would leave a client
// with no inbound from the reseller's allow-list.
var ErrResellerInboundRequired = errors.New("at least one inbound is required")

const resellerMaxCommentRunes = 200

func cleanComment(v string) string {
	v = strings.TrimSpace(v)
	if r := []rune(v); len(r) > resellerMaxCommentRunes {
		v = string(r[:resellerMaxCommentRunes])
	}
	return v
}

// CreateClient creates a client on one of the reseller's allowed inbounds.
//
// The incoming model.Client is NOT trusted: only email, traffic limit, expiry
// and comment are read from it. Everything else (group, traffic ratio, IP
// limit, reset/renewal settings, reverse tag, sub id, credentials, ...) is
// either forced from the reseller's own record or left to server defaults, so
// a reseller cannot, for example, zero its own traffic ratio to hide usage.
//
// The traffic limit is debited from the quota BEFORE the client is created, in
// a row-locked transaction. ClientService.CreateOne returns (needRestart,
// error) - the bool is NOT "was created" - so success is judged by err alone;
// on error the debit is reversed.
func (s *ResellerService) CreateClient(inboundSvc *InboundService, r *model.Reseller, inboundIds []int, in model.Client) (bool, error) {
	// Every requested inbound must be on the reseller's allow-list; one
	// disallowed id rejects the whole request. Duplicates are dropped.
	ids := make([]int, 0, len(inboundIds))
	seen := make(map[int]struct{}, len(inboundIds))
	for _, id := range inboundIds {
		if _, dup := seen[id]; dup {
			continue
		}
		if !inboundAllowed(r, id) {
			return false, ErrResellerForbidden
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return false, ErrResellerForbidden
	}
	if in.TotalGB <= 0 {
		return false, ErrResellerTrafficRequired
	}
	client := model.Client{
		Email:        strings.TrimSpace(in.Email),
		TotalGB:      in.TotalGB,
		ExpiryTime:   in.ExpiryTime,
		Comment:      cleanComment(in.Comment),
		Enable:       true,
		Group:        r.GroupName,
		TrafficRatio: normalizeRatio(r.TrafficRatio),
	}

	if err := s.debit(r.Id, client.TotalGB); err != nil {
		return false, err
	}
	// One client record shared by all chosen inbounds: the traffic limit is
	// debited once, not once per inbound.
	if _, err := s.clientService.Create(inboundSvc, &ClientCreatePayload{
		Client:     client,
		InboundIds: ids,
	}); err != nil {
		s.credit(r.Id, client.TotalGB)
		return false, err
	}
	return true, nil
}

// ResellerClientEdit is the only part of a client a reseller may change. A nil
// field means "leave as is".
type ResellerClientEdit struct {
	TotalGB    *int64
	ExpiryTime *int64
	Comment    *string
	// InboundIds, when set, is the complete list of the reseller's ALLOWED
	// inbounds the client should be attached to. Inbounds outside the
	// reseller's allow-list are neither shown nor touched.
	InboundIds *[]int
}

// UpdateClient edits one of the reseller's own clients. Only the traffic
// limit, expiry and comment can change; everything else is taken from the
// stored record. Raising the traffic limit is charged against the quota (the
// difference); lowering it is refused, and it can never be removed, so editing
// is never a way around the quota.
func (s *ResellerService) UpdateClient(inboundSvc *InboundService, r *model.Reseller, email string, edit ResellerClientEdit) (bool, error) {
	rec, err := s.ownClientOrForbidden(r, email)
	if err != nil {
		return false, err
	}
	updated := *rec.ToClient()
	updated.Group = r.GroupName

	if edit.TotalGB != nil {
		if *edit.TotalGB <= 0 {
			return false, ErrResellerTrafficRequired
		}
		if *edit.TotalGB < rec.TotalGB {
			return false, ErrResellerLimitDecrease
		}
		updated.TotalGB = *edit.TotalGB
	}
	if updated.TotalGB <= 0 {
		return false, ErrResellerTrafficRequired
	}
	if edit.ExpiryTime != nil {
		updated.ExpiryTime = *edit.ExpiryTime
	}
	if edit.Comment != nil {
		updated.Comment = cleanComment(*edit.Comment)
	}

	// Validate the requested inbound set before anything is charged.
	var attach, detach []int
	if edit.InboundIds != nil {
		current, err := s.clientService.GetInboundIdsForRecord(rec.Id)
		if err != nil {
			return false, err
		}
		have := make(map[int]struct{}, len(current))
		for _, id := range current {
			have[id] = struct{}{}
		}
		want := make(map[int]struct{}, len(*edit.InboundIds))
		for _, id := range *edit.InboundIds {
			if !inboundAllowed(r, id) {
				return false, ErrResellerForbidden
			}
			want[id] = struct{}{}
		}
		if len(want) == 0 {
			return false, ErrResellerInboundRequired
		}
		for id := range want {
			if _, ok := have[id]; !ok {
				attach = append(attach, id)
			}
		}
		for _, id := range current {
			// Only inbounds the reseller is allowed to manage can be detached;
			// anything else the admin attached stays exactly as it is.
			if _, keep := want[id]; !keep && inboundAllowed(r, id) {
				detach = append(detach, id)
			}
		}
	}

	extra := updated.TotalGB - rec.TotalGB
	if extra > 0 {
		if err := s.debit(r.Id, extra); err != nil {
			return false, err
		}
	}
	if _, err := s.clientService.UpdateByEmail(inboundSvc, email, updated, rec.LimitHwid); err != nil {
		if extra > 0 {
			s.credit(r.Id, extra)
		}
		return false, err
	}
	// Attach first so the client is never left without an inbound.
	if len(attach) > 0 {
		if _, err := s.clientService.AttachByEmail(inboundSvc, email, attach); err != nil {
			return false, err
		}
	}
	if len(detach) > 0 {
		if _, err := s.clientService.DetachByEmailMany(inboundSvc, email, detach); err != nil {
			return false, err
		}
	}
	return true, nil
}

// SetClientEnable toggles one of the reseller's own clients.
func (s *ResellerService) SetClientEnable(inboundSvc *InboundService, r *model.Reseller, email string, enable bool) (bool, error) {
	if _, err := s.ownClientOrForbidden(r, email); err != nil {
		return false, err
	}
	if _, _, err := s.clientService.BulkSetEnable(inboundSvc, []string{email}, enable); err != nil {
		return false, err
	}
	return true, nil
}

// ResetClientTraffic resets usage on one of the reseller's own clients. A
// reset hands the customer a fresh allowance, so it is charged against the
// quota exactly like selling that volume again (the client's traffic limit).
// Without this a reseller could reset a client forever and never run out.
func (s *ResellerService) ResetClientTraffic(inboundSvc *InboundService, r *model.Reseller, email string) (bool, error) {
	rec, err := s.ownClientOrForbidden(r, email)
	if err != nil {
		return false, err
	}
	if err := s.debit(r.Id, rec.TotalGB); err != nil {
		return false, err
	}
	if _, err := s.clientService.ResetTrafficByEmail(inboundSvc, email); err != nil {
		s.credit(r.Id, rec.TotalGB)
		return false, err
	}
	return true, nil
}

// DeleteClient deletes one of the reseller's own clients. Within
// resellerDeleteGraceMillis of creation, and only if the client never carried
// traffic and has never been online (and is not online right now), its whole
// traffic limit is credited back to the quota - an unmistakable mis-click, not
// a used sale. Any later delete, or one after the client connected, leaves the
// ledger exactly where it was.
func (s *ResellerService) DeleteClient(inboundSvc *InboundService, r *model.Reseller, email string) (bool, error) {
	rec, err := s.ownClientOrForbidden(r, email)
	if err != nil {
		return false, err
	}

	// Decide refund eligibility from the state BEFORE the delete removes the
	// traffic row.
	refund := false
	age := time.Now().UnixMilli() - rec.CreatedAt
	if age >= 0 && age <= resellerDeleteGraceMillis && rec.TotalGB > 0 {
		var traffic xray.ClientTraffic
		terr := database.GetDB().Where("email = ?", email).First(&traffic).Error
		neverUsed := terr == nil && traffic.Up == 0 && traffic.Down == 0 && traffic.LastOnline == 0
		if terr != nil && errors.Is(terr, gorm.ErrRecordNotFound) {
			neverUsed = true
		}
		if neverUsed {
			refund = true
			for _, online := range inboundSvc.GetOnlineClients() {
				if online == email {
					refund = false
					break
				}
			}
		}
	}

	if _, err := s.clientService.DeleteByEmail(inboundSvc, email, false); err != nil {
		return false, err
	}
	if refund {
		s.credit(r.Id, rec.TotalGB)
	}
	return true, nil
}

// ListClients returns one page of the reseller's own clients, together with
// dashboard counters that cover ONLY those clients.
func (s *ResellerService) ListClients(inboundSvc *InboundService, settingSvc *SettingService, r *model.Reseller, params ClientPageParams) (*ClientPageResponse, error) {
	params.Group = ""
	params.Protocol = ""
	params.Inbound = ""
	resp, err := s.clientService.ListPagedScoped(inboundSvc, settingSvc, params, r.GroupName)
	if err != nil {
		return nil, err
	}
	// A reseller only ever learns about inbounds it is allowed to use.
	for i := range resp.Items {
		kept := make([]int, 0, len(resp.Items[i].InboundIds))
		for _, id := range resp.Items[i].InboundIds {
			if inboundAllowed(r, id) {
				kept = append(kept, id)
			}
		}
		resp.Items[i].InboundIds = kept
	}
	return resp, nil
}

// ResellerClientLinks is what the reseller's "client info" and QR dialogs show
// for one of its own clients: the subscription URLs and the config links.
type ResellerClientLinks struct {
	SubId      string   `json:"subId"`
	SubURL     string   `json:"subUrl"`
	SubJSONURL string   `json:"subJsonUrl"`
	Links      []string `json:"links"`
}

// ClientLinks resolves subscription and config links for one of the
// reseller's own clients (the ownership check runs first).
func (s *ResellerService) ClientLinks(inboundSvc *InboundService, settingSvc *SettingService, r *model.Reseller, host, email string) (*ResellerClientLinks, error) {
	rec, err := s.ownClientOrForbidden(r, email)
	if err != nil {
		return nil, err
	}
	out := &ResellerClientLinks{SubId: rec.SubID, Links: []string{}}
	if rec.SubID == "" {
		return out, nil
	}
	if settings, sErr := settingSvc.GetDefaultSettings(host); sErr == nil {
		if m, ok := settings.(map[string]any); ok {
			if enabled, _ := m["subEnable"].(bool); enabled {
				if uri, _ := m["subURI"].(string); uri != "" {
					out.SubURL = uri + rec.SubID
				}
			}
			if enabled, _ := m["subJsonEnable"].(bool); enabled {
				if uri, _ := m["subJsonURI"].(string); uri != "" {
					out.SubJSONURL = uri + rec.SubID
				}
			}
		}
	}
	if links, lErr := inboundSvc.GetSubLinks(host, rec.SubID); lErr == nil && links != nil {
		out.Links = links
	}
	return out, nil
}

// RecalculateUsage rebuilds a reseller's UsedBytes from the clients that
// currently exist in its group (the sum of their traffic limits). Meant as a
// one-off repair after the ledger was out of sync: clients that were already
// deleted no longer count, so any earlier permanent charge for them is lost.
func (s *ResellerService) RecalculateUsage(id int) (*model.Reseller, error) {
	db := database.GetDB()
	var r model.Reseller
	if err := db.First(&r, "id = ?", id).Error; err != nil {
		return nil, err
	}
	var sum int64
	if err := db.Model(&model.ClientRecord{}).
		Where("group_name = ?", r.GroupName).
		Select("COALESCE(SUM(total_gb), 0)").
		Scan(&sum).Error; err != nil {
		return nil, err
	}
	if err := db.Model(&model.Reseller{}).Where("id = ?", r.Id).
		UpdateColumn("used_bytes", sum).Error; err != nil {
		return nil, err
	}
	r.UsedBytes = sum
	return &r, nil
}
