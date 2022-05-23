using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;
using System.Security;
using Microsoft.AspNet.Identity.EntityFramework;

namespace GuessNumber.Models
{
    public class AppUser : IdentityUser
    {
        public string Country { get; set; }
    }
}