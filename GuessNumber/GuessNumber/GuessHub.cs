using Microsoft.AspNet.SignalR;
using Microsoft.AspNet.SignalR.Hubs;
using Microsoft.AspNet.SignalR.Infrastructure;
using Microsoft.AspNet.SignalR.Hosting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;
using System.IO;
using Newtonsoft.Json;
using System.Web.Helpers;
using System.Threading.Tasks;
using System.Runtime.Caching;

namespace GuessNumber.Models
{
    public class GuessHub: Hub
    {
        public override Task OnConnected()
        {
            ObjectCache cache = MemoryCache.Default;
            KeyValuePair<String, Object>[] C = cache.ToArray();
            foreach (KeyValuePair<String, Object> F in C)
            {
                Clients.Caller.ReceiveName(F.Value, F.Key); 
            }
            Clients.Caller.IAmConnected(Context.ConnectionId);
            return base.OnConnected();
        }
        public override Task OnDisconnected()
        {
            ObjectCache cache = MemoryCache.Default;
            Clients.Others.RemoveId(Context.ConnectionId);
            cache.Remove(Context.ConnectionId);
            return base.OnDisconnected();
        }
        public override Task OnReconnected()
        {
            ObjectCache cache = MemoryCache.Default;
            KeyValuePair<String, Object>[] C = cache.ToArray();
            foreach (KeyValuePair<String, Object> F in C)
            {
                Clients.Caller.ReceiveName(F.Value, F.Key);
            }
            Clients.Caller.IAmConnected(Context.ConnectionId);            
            return base.OnReconnected();
        }

        public void choice(string action, string group, string pname)
        {
            Clients.OthersInGroup(group).Gameaction(pname, action);
        }
        public void SaveMyConnectionId(string myname)
        {
            ObjectCache cache = MemoryCache.Default;
            CacheItemPolicy policy = new CacheItemPolicy();
            cache.Set(Context.ConnectionId, myname, policy);
            Clients.Others.ReceiveName(myname, Context.ConnectionId); 
        }

        public void passId(string id)
        {
            Clients.Caller.CoolStore(id);
            Clients.Client(id).ReceiveInvite(Context.ConnectionId);
        }
       
        public void passReply(string id, string offer)
        {
            
            if (String.IsNullOrEmpty(offer))
            {
                Clients.Client(id).Rejection(); 
            }
            else
            {
                try
                {
                    //IConnection C = null;
                    String NewChatGroup = Guid.NewGuid().ToString("N");
                    //var context = GlobalHost.ConnectionManager.GetHubContext<GuessHub>();
                    
                    Groups.Add(Context.ConnectionId, NewChatGroup);
                    Groups.Add(id, NewChatGroup);
                    Clients.Caller.ReceiveToken(NewChatGroup);
                    Clients.Client(id).ReceiveToken(NewChatGroup);                    
                }
                catch(Exception ex)
                {
                    Clients.All.fail(ex.ToString());
                }
            }
        }
        public void useForPassReply(string NewChatGroup)
        {
           //List<string> F  = new List<string>();           
           Clients.OthersInGroup(NewChatGroup).Accept();
           NewChatGroup = null;
        }
        public void passNumber(string NewChatGroup, string num, string type)
        {
            Clients.OthersInGroup(NewChatGroup).GetNumber(num, type);
        }

        public void passMessage(string msg, string group)
        {
            Clients.OthersInGroup(group).receiveMessage(msg);
        }
        public void GetAllNames()
        {
            ObjectCache cache = MemoryCache.Default;
            Object C = cache.ToArray();
            string fileContents = cache["pctwo"] as string;
            List<string> filePaths = new List<string>();
            string fileContent = cache["pcfour"] as string;
            filePaths.Add(fileContents);
            filePaths.Add(fileContent);
            Clients.Caller.ViewAllNames(filePaths);

        }
    }
}