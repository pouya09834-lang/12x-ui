package controller

import (
	"strconv"

	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
	"github.com/mhsanaei/3x-ui/v3/internal/web/service"

	"github.com/gin-gonic/gin"
)

// ResellerAdminController is the admin-only "Resellers" management surface:
// create/list/update/delete reseller accounts and issue/rotate their bot API
// keys. Mounted under /panel/api/resellers, so it inherits that group's
// existing admin-session/token auth and CSRF middleware — no auth code of
// its own.
type ResellerAdminController struct {
	resellerService service.ResellerService
}

func NewResellerAdminController(g *gin.RouterGroup) *ResellerAdminController {
	a := &ResellerAdminController{}
	a.initRouter(g)
	return a
}

func (a *ResellerAdminController) initRouter(g *gin.RouterGroup) {
	g.GET("/list", a.list)
	g.POST("/create", a.create)
	g.POST("/update/:id", a.update)
	g.POST("/regenerateApiKey/:id", a.regenerateApiKey)
	g.POST("/delete/:id", a.delete)
}

// resellerView is what the admin list/create/update response shows — the
// password and API-key hashes never leave the server.
type resellerView struct {
	Id                int    `json:"id"`
	Username          string `json:"username"`
	GroupName         string `json:"groupName"`
	AllowedInboundIds []int  `json:"allowedInboundIds"`
	QuotaBytes        int64  `json:"quotaBytes"`
	UsedBytes         int64  `json:"usedBytes"`
	Enabled           bool   `json:"enabled"`
	CreatedAt         int64  `json:"createdAt"`
}

func viewOfReseller(r *model.Reseller) resellerView {
	return resellerView{
		Id:                r.Id,
		Username:          r.Username,
		GroupName:         r.GroupName,
		AllowedInboundIds: r.AllowedInboundIds,
		QuotaBytes:        r.QuotaBytes,
		UsedBytes:         r.UsedBytes,
		Enabled:           r.Enabled,
		CreatedAt:         r.CreatedAt,
	}
}

func resellerIdParam(c *gin.Context) (int, error) {
	return strconv.Atoi(c.Param("id"))
}

func (a *ResellerAdminController) list(c *gin.Context) {
	rows, err := a.resellerService.List()
	if err != nil {
		jsonMsg(c, "failed to list resellers", err)
		return
	}
	views := make([]resellerView, 0, len(rows))
	for i := range rows {
		views = append(views, viewOfReseller(&rows[i]))
	}
	jsonObj(c, views, nil)
}

// resellerCreateResponse includes the plaintext API key exactly once — the
// server never stores or returns it again after this response.
type resellerCreateResponse struct {
	Reseller resellerView `json:"reseller"`
	ApiKey   string       `json:"apiKey"`
}

func (a *ResellerAdminController) create(c *gin.Context) {
	var payload service.ResellerCreatePayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		jsonMsg(c, "invalid request", err)
		return
	}
	r, apiKey, err := a.resellerService.Create(payload)
	if err != nil {
		jsonMsg(c, "failed to create reseller", err)
		return
	}
	jsonObj(c, resellerCreateResponse{Reseller: viewOfReseller(r), ApiKey: apiKey}, nil)
}

func (a *ResellerAdminController) update(c *gin.Context) {
	id, err := resellerIdParam(c)
	if err != nil {
		jsonMsg(c, "invalid id", err)
		return
	}
	var payload service.ResellerUpdatePayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		jsonMsg(c, "invalid request", err)
		return
	}
	r, err := a.resellerService.Update(id, payload)
	if err != nil {
		jsonMsg(c, "failed to update reseller", err)
		return
	}
	jsonObj(c, viewOfReseller(r), nil)
}

func (a *ResellerAdminController) regenerateApiKey(c *gin.Context) {
	id, err := resellerIdParam(c)
	if err != nil {
		jsonMsg(c, "invalid id", err)
		return
	}
	apiKey, err := a.resellerService.RegenerateApiKey(id)
	if err != nil {
		jsonMsg(c, "failed to regenerate api key", err)
		return
	}
	jsonObj(c, gin.H{"apiKey": apiKey}, nil)
}

func (a *ResellerAdminController) delete(c *gin.Context) {
	id, err := resellerIdParam(c)
	if err != nil {
		jsonMsg(c, "invalid id", err)
		return
	}
	if err := a.resellerService.Delete(id); err != nil {
		jsonMsg(c, "failed to delete reseller", err)
		return
	}
	jsonObj(c, gin.H{"success": true}, nil)
}
