using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Owin;
using System.Security.Claims;
using System.Threading.Tasks;
using System.Web;
using System.Web.Mvc;
using GuessNumber.Models;
using Microsoft.AspNet.Identity;



namespace GuessNumber.Controllers
{
    [AllowAnonymous]
    public class AuthController : Controller
    {
        //
        // GET: /Auth/
        private readonly UserManager<AppUser> userManager;

        public AuthController()
            : this(Startup.UserManagerFactory.Invoke())
        {
        }

        public AuthController(UserManager<AppUser> userManager)
        {
            this.userManager = userManager;
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing && userManager != null)
            {
                userManager.Dispose();
            }
            base.Dispose(disposing);
        }
        [HttpGet]
        public ActionResult LogIn(string returnUrl)
        {
            var model = new GuessNumber.Models.LogInModel
            {
                ReturnUrl = returnUrl
            };

            return View(model);


        }

        [HttpPost]
        public async Task<ActionResult> LogIn(LogInModel model)
        {
            if (!ModelState.IsValid)
            {
                return View();
            }
            
            var user = await userManager.FindAsync(model.Email, model.Password);
            var t = HttpContext.GetOwinContext();
            
            if (user != null)
            {
                var identity = await userManager.CreateIdentityAsync(
                    user, DefaultAuthenticationTypes.ApplicationCookie);
                
                t.Authentication.SignIn(identity);

                return Redirect(GetRedirectUrl(model.ReturnUrl));
            }

            // user authN failed
            ModelState.AddModelError("", "Invalid email or password");
            return View();
        }

      

        private string GetRedirectUrl(string returnUrl)
        {
            if (string.IsNullOrEmpty(returnUrl) || !Url.IsLocalUrl(returnUrl))
            {
                return Url.Action("index", "home");
            }

            return returnUrl;
        }
        public ActionResult LogOut()
        {
            var ctx = Request.GetOwinContext();
            var authManager = ctx.Authentication;

            authManager.SignOut("ApplicationCookie");
            return RedirectToAction("index", "home");
        }
    }
}
