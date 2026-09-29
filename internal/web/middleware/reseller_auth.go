package middleware

import (
	"net/http"
	"strings"

	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
	"github.com/mhsanaei/3x-ui/v3/internal/web/service"
	"github.com/mhsanaei/3x-ui/v3/internal/web/session"

	"github.com/gin-gonic/gin"
)

const resellerContextKey = "current_reseller"

// ResellerAuthMiddleware resolves the caller's reseller identity two ways —
// a browser session (the reseller's own web panel) or a bearer API key (the
// reseller's own bot) — and aborts with 401 if neither matches an enabled
// reseller. A resolved reseller is stored on the context for handlers and
// also flags api_authed so CSRFMiddleware treats a bot's bearer call like
// any other non-browser API caller.
func ResellerAuthMiddleware(resellerService *service.ResellerService) gin.HandlerFunc {
	return func(c *gin.Context) {
		if auth := c.GetHeader("Authorization"); auth != "" {
			if key, ok := strings.CutPrefix(auth, "Bearer "); ok {
				if r, ok := resellerService.MatchApiKey(key); ok {
					c.Set(resellerContextKey, r)
					c.Set("api_authed", true)
					c.Next()
					return
				}
				c.AbortWithStatus(http.StatusUnauthorized)
				return
			}
		}
		if id, ok := session.GetResellerSession(c); ok {
			r, err := resellerService.Get(id)
			if err == nil && r.Enabled {
				c.Set(resellerContextKey, r)
				c.Next()
				return
			}
		}
		c.AbortWithStatus(http.StatusUnauthorized)
	}
}

// CurrentReseller reads the reseller resolved by ResellerAuthMiddleware. Only
// call this on routes behind that middleware.
func CurrentReseller(c *gin.Context) *model.Reseller {
	if v, ok := c.Get(resellerContextKey); ok {
		if r, ok2 := v.(*model.Reseller); ok2 {
			return r
		}
	}
	return nil
}
