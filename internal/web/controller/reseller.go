package controller

import (
	"errors"
	"net/http"
	"time"

	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
	"github.com/mhsanaei/3x-ui/v3/internal/logger"
	"github.com/mhsanaei/3x-ui/v3/internal/web/middleware"
	"github.com/mhsanaei/3x-ui/v3/internal/web/service"
	"github.com/mhsanaei/3x-ui/v3/internal/web/session"

	"github.com/gin-gonic/gin"
)

// ResellerController serves the reseller's own surface: its web login (a
// session namespace fully separate from the admin login) and, behind that
// session OR a bot's bearer API key, a clients+quota API scoped to exactly
// that reseller's group and allowed inbounds. It never exposes inbound,
// xray, or settings management — those routes simply don't exist here.
type ResellerController struct {
	resellerService service.ResellerService
	clientService   service.ClientService
	inboundService  service.InboundService
	settingService  service.SettingService
}

// ResellerLoginForm is the reseller web-login request body.
type ResellerLoginForm struct {
	Username string `json:"username" form:"username"`
	Password string `json:"password" form:"password"`
}

func NewResellerController(g *gin.RouterGroup) *ResellerController {
	a := &ResellerController{}
	a.initRouter(g)
	return a
}

func (a *ResellerController) initRouter(g *gin.RouterGroup) {
	reseller := g.Group("/reseller")

	reseller.GET("/login", a.loginPage)
	reseller.GET("/app", a.appPage)
	reseller.POST("/login", middleware.CSRFMiddleware(), a.login)
	reseller.POST("/logout", middleware.CSRFMiddleware(), a.logout)

	api := reseller.Group("/api")
	api.Use(middleware.ResellerAuthMiddleware(&a.resellerService))
	api.Use(middleware.CSRFMiddleware())

	api.GET("/me", a.me)
	api.GET("/inbounds", a.allowedInbounds)

	api.GET("/clients", a.listClients)
	api.POST("/clients", a.createClient)
	api.PUT("/clients/:email", a.updateClient)
	api.POST("/clients/:email/update", a.updateClient)
	api.GET("/clients/:email/links", a.clientLinks)
	api.POST("/clients/:email/enable", a.enableClient)
	api.POST("/clients/:email/disable", a.disableClient)
	api.POST("/clients/:email/resetTraffic", a.resetClientTraffic)
	api.DELETE("/clients/:email", a.deleteClient)
}

// loginPage serves the reseller's own sign-in page. A reseller who already
// has a valid session is bounced straight to the app instead of seeing the
// form again — mirrors IndexController.index for the admin login.
func (a *ResellerController) loginPage(c *gin.Context) {
	if id, ok := session.GetResellerSession(c); ok {
		if r, err := a.resellerService.Get(id); err == nil && r.Enabled {
			c.Header("Cache-Control", "no-store")
			c.Redirect(http.StatusTemporaryRedirect, c.GetString("base_path")+"reseller/app")
			return
		}
	}
	serveDistPage(c, "reseller-login.html")
}

// appPage serves the reseller's dashboard shell. Unlike the admin panel,
// there is no client-side router here — reseller-app.html is a single page,
// so an expired/missing session just bounces back to the login page.
func (a *ResellerController) appPage(c *gin.Context) {
	id, ok := session.GetResellerSession(c)
	valid := false
	if ok {
		if r, err := a.resellerService.Get(id); err == nil && r.Enabled {
			valid = true
		}
	}
	if !valid {
		c.Header("Cache-Control", "no-store")
		c.Redirect(http.StatusTemporaryRedirect, c.GetString("base_path")+"reseller/login")
		return
	}
	serveDistPage(c, "reseller-app.html")
}

// login authenticates a reseller's own web-panel session. It shares the
// admin login's brute-force limiter (same remote IP, keyed by this
// reseller's username) rather than a second independent one.
func (a *ResellerController) login(c *gin.Context) {
	var form ResellerLoginForm
	if err := c.ShouldBind(&form); err != nil || form.Username == "" || form.Password == "" {
		pureJsonMsg(c, http.StatusOK, false, "invalid username or password")
		return
	}

	remoteIP := getRemoteIp(c)
	if blockedUntil, ok := defaultLoginLimiter.allow(remoteIP, form.Username); !ok {
		logger.Warningf("failed reseller login: username=%q, IP=%q, blocked_until=%s", form.Username, remoteIP, blockedUntil.Format(time.RFC3339))
		pureJsonMsg(c, http.StatusOK, false, "wrong username or password")
		return
	}

	r, err := a.resellerService.Authenticate(form.Username, form.Password)
	if err != nil {
		if blockedUntil, blocked := defaultLoginLimiter.registerFailure(remoteIP, form.Username); blocked {
			logger.Warningf("failed reseller login: username=%q, IP=%q, blocked_until=%s", form.Username, remoteIP, blockedUntil.Format(time.RFC3339))
		}
		pureJsonMsg(c, http.StatusOK, false, "wrong username or password")
		return
	}

	defaultLoginLimiter.registerSuccess(remoteIP, form.Username)
	if err := session.SetResellerSession(c, r.Id); err != nil {
		logger.Warning("Unable to save reseller session:", err)
		jsonMsg(c, "failed to start session", err)
		return
	}
	jsonMsg(c, "logged in", nil)
}

func (a *ResellerController) logout(c *gin.Context) {
	_ = session.ClearResellerSession(c)
	jsonMsg(c, "logged out", nil)
}

// resellerQuotaView is the JSON shape resellers see for themselves — never
// the password/api-key hashes, and QuotaBytes/UsedBytes spelled out
// explicitly so the frontend doesn't need to know the internal ledger names.
type resellerQuotaView struct {
	Username          string `json:"username"`
	GroupName         string `json:"groupName"`
	AllowedInboundIds []int  `json:"allowedInboundIds"`
	QuotaBytes        int64  `json:"quotaBytes"`
	UsedBytes         int64  `json:"usedBytes"`
	RemainingBytes    int64  `json:"remainingBytes"`
}

func (a *ResellerController) me(c *gin.Context) {
	r := middleware.CurrentReseller(c)
	remaining := r.QuotaBytes - r.UsedBytes
	if remaining < 0 {
		remaining = 0
	}
	jsonObj(c, resellerQuotaView{
		Username:          r.Username,
		GroupName:         r.GroupName,
		AllowedInboundIds: r.AllowedInboundIds,
		QuotaBytes:        r.QuotaBytes,
		UsedBytes:         r.UsedBytes,
		RemainingBytes:    remaining,
	}, nil)
}

// resellerInboundView is a deliberately thin projection — id, a label to
// show in the create-client dropdown, protocol and port — never the full
// inbound settings/streamSettings JSON, which is exactly the configuration
// surface a reseller must not see.
type resellerInboundView struct {
	Id       int    `json:"id"`
	Remark   string `json:"remark"`
	Protocol string `json:"protocol"`
	Port     int    `json:"port"`
}

func (a *ResellerController) allowedInbounds(c *gin.Context) {
	r := middleware.CurrentReseller(c)
	allowed := make(map[int]struct{}, len(r.AllowedInboundIds))
	for _, id := range r.AllowedInboundIds {
		allowed[id] = struct{}{}
	}
	all, err := a.inboundService.GetAllInbounds()
	if err != nil {
		jsonMsg(c, "failed to load inbounds", err)
		return
	}
	views := make([]resellerInboundView, 0, len(allowed))
	for _, ib := range all {
		if _, ok := allowed[ib.Id]; !ok {
			continue
		}
		views = append(views, resellerInboundView{Id: ib.Id, Remark: ib.Remark, Protocol: string(ib.Protocol), Port: ib.Port})
	}
	jsonObj(c, views, nil)
}

// resellerClientListParams accepts only display/search knobs — no Group and
// no way to widen scope; ListClients always forces Group to the caller's
// own before it ever reaches ClientService.
type resellerClientListParams struct {
	Page     int    `form:"page"`
	PageSize int    `form:"pageSize"`
	Search   string `form:"search"`
	Sort     string `form:"sort"`
	Order    string `form:"order"`
	Filter   string `form:"filter"`
}

func (a *ResellerController) listClients(c *gin.Context) {
	r := middleware.CurrentReseller(c)
	var p resellerClientListParams
	if err := c.ShouldBindQuery(&p); err != nil {
		jsonMsg(c, "invalid query", err)
		return
	}
	resp, err := a.resellerService.ListClients(&a.inboundService, &a.settingService, r, service.ClientPageParams{
		Page: p.Page, PageSize: p.PageSize, Search: p.Search, Sort: p.Sort, Order: p.Order, Filter: p.Filter,
	})
	if err != nil {
		jsonMsg(c, "failed to list clients", err)
		return
	}
	jsonObj(c, resp, nil)
}

// resellerCreateClientRequest intentionally has no Group field: ownership is
// never taken from the request body.
type resellerCreateClientRequest struct {
	InboundId  int    `json:"inboundId"`
	Client     model.Client `json:"client"`
}

func (a *ResellerController) createClient(c *gin.Context) {
	r := middleware.CurrentReseller(c)
	var req resellerCreateClientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonMsg(c, "invalid request", err)
		return
	}
	ok, err := a.resellerService.CreateClient(&a.inboundService, r, req.InboundId, req.Client)
	respondResellerAction(c, ok, err)
}

// resellerUpdateClientRequest carries only what a reseller may edit. Any other
// field a caller might add to the JSON body is simply not bound.
type resellerUpdateClientRequest struct {
	TotalGB    *int64  `json:"totalGB"`
	ExpiryTime *int64  `json:"expiryTime"`
	Comment    *string `json:"comment"`
}

func (a *ResellerController) updateClient(c *gin.Context) {
	r := middleware.CurrentReseller(c)
	email := c.Param("email")
	var req resellerUpdateClientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonMsg(c, "invalid request", err)
		return
	}
	ok, err := a.resellerService.UpdateClient(&a.inboundService, r, email, service.ResellerClientEdit{
		TotalGB: req.TotalGB, ExpiryTime: req.ExpiryTime, Comment: req.Comment,
	})
	respondResellerAction(c, ok, err)
}

// clientLinks returns the subscription URLs and config links of one of the
// caller's own clients (ownership is checked in the service).
func (a *ResellerController) clientLinks(c *gin.Context) {
	r := middleware.CurrentReseller(c)
	links, err := a.resellerService.ClientLinks(&a.inboundService, &a.settingService, r, resolveHost(c), c.Param("email"))
	if err != nil {
		if errors.Is(err, service.ErrResellerForbidden) {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		jsonMsg(c, "failed to load links", err)
		return
	}
	jsonObj(c, links, nil)
}

func (a *ResellerController) enableClient(c *gin.Context) {
	r := middleware.CurrentReseller(c)
	ok, err := a.resellerService.SetClientEnable(&a.inboundService, r, c.Param("email"), true)
	respondResellerAction(c, ok, err)
}

func (a *ResellerController) disableClient(c *gin.Context) {
	r := middleware.CurrentReseller(c)
	ok, err := a.resellerService.SetClientEnable(&a.inboundService, r, c.Param("email"), false)
	respondResellerAction(c, ok, err)
}

func (a *ResellerController) resetClientTraffic(c *gin.Context) {
	r := middleware.CurrentReseller(c)
	ok, err := a.resellerService.ResetClientTraffic(&a.inboundService, r, c.Param("email"))
	respondResellerAction(c, ok, err)
}

func (a *ResellerController) deleteClient(c *gin.Context) {
	r := middleware.CurrentReseller(c)
	ok, err := a.resellerService.DeleteClient(&a.inboundService, r, c.Param("email"))
	respondResellerAction(c, ok, err)
}

// respondResellerAction maps the service-layer sentinel errors to the right
// HTTP status; anything else is a generic failure message.
func respondResellerAction(c *gin.Context, ok bool, err error) {
	switch {
	case errors.Is(err, service.ErrResellerForbidden):
		c.AbortWithStatus(http.StatusForbidden)
	case errors.Is(err, service.ErrResellerQuotaExceeded):
		pureJsonMsg(c, http.StatusOK, false, "traffic quota exceeded")
	case errors.Is(err, service.ErrResellerLimitDecrease):
		pureJsonMsg(c, http.StatusOK, false, "the traffic limit can only be increased")
	case errors.Is(err, service.ErrResellerTrafficRequired):
		pureJsonMsg(c, http.StatusOK, false, "a traffic limit greater than 0 is required")
	case err != nil:
		jsonMsg(c, "operation failed", err)
	default:
		jsonObj(c, gin.H{"success": ok}, nil)
	}
}
