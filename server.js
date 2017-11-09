var Deepstream = require("deepstream.io");
var RethinkDB = require("deepstream.io-storage-rethinkdb");
var deepstreamClient = require("deepstream.io-client-js");
var GoogleAuth = require("google-auth-library");
var dotenv = require("dotenv");
var r = require("rethinkdb");
var winston = require("winston");

winston.level = "debug";
const server = new Deepstream("conf/config.yml");
var dsClient;
var config = dotenv.config().parsed;
var connection = null;
var ready = false;

//Google auth setup
var googleClientID = config.GOOGLE_CLIENT_ID;
var auth = new GoogleAuth();
var client = new auth.OAuth2(googleClientID, "", "");

function googleLogin(authData, callback)
{
  client.verifyIdToken(authData.idToken, googleClientID, (error, login) =>
  {
    if(error)
    {
      console.log(error);
      callback(null, {username: "Access denied", clientData: {googleError: true}});
      return;
    }
    if(!login)
    {
      console.log("Error: can't get payload from idToken");
      callback(null, {username: "Access denied", clientData: {googleError: true}});
      return;
    }
    var payload = login.getPayload();
    //Check if a user with a matching Google ID exists in the database
    r.db("deepstream").table("auth").filter(r.row("googleID").eq(payload.sub)).run(connection, (error, cursor) =>
    {
      if(error)
      {
        console.log(error);
        callback(null, {username: "Access denied"});
        return;
      }
      cursor.toArray(function(error, profiles)
      {
        if(error)
        {
          console.log(error);
          callback(null, {username: "Access denied"});
          return;
        }
        if(profiles.length === 1 && profiles[0].username)
        {
          //Found user, so set the profile picture and log the user in with their username
          dsClient.record.getRecord("user/" + profiles[0].username).whenReady(userRecord =>
          {
            userRecord.set("profilePic", payload.picture);
            callback(true, {username: profiles[0].username, serverData:{idToken: authData.idToken, role: "user"}, clientData: {username: profiles[0].username}});
          });
        }
        else if(profiles.length > 1)
        {
          //There should be at most one user with the given Google ID
          console.log("Error: more than one user with given Google ID");
          callback(null, {username: "Access denied"});
        }
        else if(authData.username)
        {
          //No user found, so user needs to set a username to create an account
          //If a username was requested, attempt to create the account. Otherwise, do not log in
          console.log("Creating user with username", authData.username);
          dsClient.rpc.make("createUser", {googleID: payload.sub, username: authData.username}, (error, result) =>
          {
            if(error)
            {
              console.log(error);
              callback(null, {username: "Access denied", clientData: result});
            }
            else if(result.username)
            {
              //User creation succeeded
              dsClient.record.getRecord("user/" + result.username).whenReady(userRecord =>
              {
                userRecord.set("profilePic", payload.picture);
                callback(true, {username: result.username, serverData:{idToken: authData.idToken, role: "user"}, clientData: result});
              });
            }
            else
            {
              //No username was returned, so creating the user failed
              callback(null, {username: "Access denied", clientData: result});
            }
          });
        }
        else
        {
          console.log("Error: no user with matching Google ID exists and no username was given. Redirecting to account creation page");
          callback(null, {username: "Access denied", clientData: {needsUsername: true}});
        }
      });
    });
  });
}

//Deepstream setup
server.set("authenticationHandler",
{
  isValidUser: function(connectionData, authData, callback)
  {
    //Deny login if the server is not yet ready and the user logging in is not the server
    if (!(ready || (connectionData.remoteAddress === "127.0.0.1" && !authData.idToken)))
    {
      callback({username: "Access denied"});
    }
    //Login with Google idToken
    else if(authData.idToken)
    {
      googleLogin(authData, callback);
    }
    else if(connectionData.remoteAddress === "127.0.0.1")
    {
      callback(true, {username: "SERVER", serverData:{role: "server"}});
    }
    else
    {
      callback({username: "Access denied"});
    }
  },
  canPerformAction: function(id, message, callback)
  {
    callback(null, true);
  },
  isReady: true
});

server.set("storage", new RethinkDB({port: parseInt(config.DB_PORT), host: config.DB_HOST, database: config.DB_NAME, defaultTable: config.DB_DEFAULT_TABLE, splitChar: "/"}));

server.on("started", () =>
{
  dsClient = deepstreamClient('localhost:6020').on("error", error =>
  {
    console.log(error);
  });
  dsClient.login({
    username: 'server'
  }, (success, data) =>
  {
    if(!success)
    {
      console.log("Error starting client");
      return;
    }

    dsClient.presence.subscribe((username, status) =>
    {
      dsClient.record.has("profile/" + username, (error, hasRecord) =>
      {
        if(error)
        {
          console.log(error);
          return;
        }
        if(!hasRecord) {return;}
        dsClient.record.getRecord("profile/" + username).whenReady(record =>
        {
          record.set("online", status);
        });
      });
    });

    dsClient.presence.getAll(users =>
    {
      for(var i = 0; i < users.length; ++i)
      {
        dsClient.record.has("profile/" + username, (error, hasRecord) =>
        {
          if(error)
          {
            console.log(error);
            return;
          }
          if(!hasRecord) {return;}
          deepstreamClient.record.getRecord("profile/" + users[i]).whenReady(record =>
          {
            record.set("online", true);
          });
        });
      }
      ready = true;
      console.log("Server ready");
    });
  });
});

r.connect({host: config.DB_HOST, port: config.DB_PORT}, (error, conn) =>
{
  if(error)
  {
    throw error;
  }
  connection = conn;
  r.db("deepstream").table("profile").update({online: false}).run(connection, (error) =>
  {
    if(error) {throw error;}
    server.start();
  });
});
