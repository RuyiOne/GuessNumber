using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;
using Microsoft.Owin;
using Owin;
//using Microsoft.Owin.Security.Cookies;
//using Microsoft.AspNet.Identity;
using GuessNumber;
//using Microsoft.AspNet.Identity.EntityFramework;

[assembly: OwinStartup(typeof(GuessNumber.Models.Startup))]

namespace GuessNumber.Models
{
    public class Startup
    {
        //public static Func<UserManager<AppUser>> UserManagerFactory { get; private set; }

        public void Configuration(IAppBuilder app)
        {

            app.MapSignalR();
            //app.UseCookieAuthentication(new CookieAuthenticationOptions
            //{
            //    AuthenticationType = DefaultAuthenticationTypes.ApplicationCookie,
            //    LoginPath = new PathString("/auth/login")
            //});

            //// configure the user manager
            //UserManagerFactory = () =>
            //{
            //    var usermanager = new UserManager<AppUser>(
            //        new UserStore<AppUser>(new AppDbContext()));
            //    // allow alphanumeric characters in username
            //    usermanager.UserValidator = new UserValidator<AppUser>(usermanager)
            //    {
            //        AllowOnlyAlphanumericUserNames = false
            //    };

            //    return usermanager;
            //};
        }
    }
}