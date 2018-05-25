const path = require('path');
var saito = require('../../../../saito');
var ModTemplate = require('../../../template');
var util = require('util');

import React from 'react'
import { renderToString } from 'react-dom/server'
import App from './app/components/App'

import renderFullPage from './server/renderFullPage'

//////////////////
// CONSTRUCTOR  //
//////////////////
function ReactApp(app) {

  if (!(this instanceof ReactApp)) { return new ReactApp(app); }

  ReactApp.super_.call(this);

  this.app                = app;

  this.name               = "ReactApp";
  this.browser_active     = 0;
  this.handlesReactApp    = 1;
  this.ReactAppAppName    = "ReactApp";

  return this;

}
module.exports = ReactApp;
util.inherits(ReactApp, ModTemplate);




ReactApp.prototype.initialize = function initialize(app) {

  if (app.BROWSER == 0) { return; }

  // remove us if mobile client is running
  if ($('#ReactApp_browser_active').length == 0) {
    for (var t = app.modules.mods.length-1; t >= 0; t--) {
      if (app.modules.mods[t].name == "ReactAppMobile") {
        app.modules.mods.splice(t, 1);
      }
    }
  }

}


/////////////////////////
// Handle Web Requests //
/////////////////////////
ReactApp.prototype.webServer = function webServer(app, expressapp) {

  const html = renderToString(<App/>)

  expressapp.get('/react-app/', function (req, res) {
    res.status(200)
    res.send(renderFullPage(html));
    return;
  });
  expressapp.get('/react-app/style.css', function (req, res) {
    res.sendFile(__dirname + '/style/style.css');
    return;
  });
  expressapp.get('/react-app/bundle.js', function (req, res) {
    res.sendFile(__dirname + '/bundle.js');
    return;
  });
}

ReactApp.prototype.isPublicKey = function isPublicKey(publickey) {
  if (publickey.length == 44 || publickey.length == 45) {
    if (publickey.indexOf("@") > 0) {} else {
      return 1;
    }
  }
  return 0;
}