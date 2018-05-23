//
// This module monitors the blockchain and our
// unspent transaction inputs. It creates fake
// transactions to speed up block production 
// for testing purposes.`
//
var saito = require('../../../saito');
var ModTemplate = require('../../template');
var util = require('util');
var crypto = require('crypto');



//////////////////
// CONSTRUCTOR  //
//////////////////
function AppStore(app) {

  if (!(this instanceof AppStore)) { return new AppStore(app); }

  AppStore.super_.call(this);

  this.app             = app;
  this.name            = "AppStore";
  this.handlesEmail    = 1;
  this.emailAppName    = "Publish to AppStore";
  return this;

}
module.exports = AppStore;
util.inherits(AppStore, ModTemplate);




////////////////////
// Install Module //
////////////////////
AppStore.prototype.installModule = function installModule() {

  var appstore_self = this;

  var sql = 'CREATE TABLE IF NOT EXISTS mod_appstore_apps (\
                id INTEGER, \
                app_id TEXT, \
                publisher TEXT, \
                title TEXT, \
                description TEXT, \
                version TEXT, \
                tx TEXT, \
                UNIQUE (id), \
                PRIMARY KEY(id ASC) \
  )';
  this.app.storage.execDatabase(sql, {}, function() {

    let tsql = "INSERT INTO mod_appstore_apps (app_id, publisher, title, description, version, tx) VALUES ($app_id, $publisher, $title, $description, $version, $tx)";
    let tparams = {
      $app_id : "12345",
      $publisher : appstore_self.app.wallet.returnPublicKey(), 
      $title  : "test application",
      $description : "a useless application used for testing",
      $version : "1.0.1",
      $tx : "{}"
    }
    appstore_self.app.storage.execDatabase(tsql, tparams, function(err) {  console.log(err); });

  });

}




/////////////////////////
// Handle Web Requests //
/////////////////////////
AppStore.prototype.webServer = function webServer(app, expressapp) {

  var appstore_self = this;

  expressapp.get('/appstore', function (req, res) {

    var psql = "SELECT * FROM mod_appstore_apps";
    var pparams = { $publickey : req.params.publickey };
    appstore_self.app.storage.queryDatabaseArray(psql, pparams, function(err, rows) {
      res.write(appstore_self.returnIndexPageHead());
      for (let i = 0; i < rows.length; i++) {
       res.write(appstore_self.returnIndexPageRow(rows[i]));
      }
      res.write(appstore_self.returnIndexPageTail());
      res.end();
      return;
    });
  });
  expressapp.get('/appstore/style.css', function (req, res) {
    res.sendFile(__dirname + '/web/style.css');
    return;
  });
  expressapp.get('/appstore/script.js', function (req, res) {
    res.sendFile(__dirname + '/web/script.js');
    return;
  });
  expressapp.post('/appstore/generateExtension', function (req, res) {

    res.setHeader('Content-type', 'text/html');
    res.charset = 'UTF-8';
    res.write("Generated Extension");
    res.end();
    return;

  });

}




/////////////////////
// Email Functions //
/////////////////////
AppStore.prototype.displayEmailForm = function displayEmailForm(app) {

  var appstore_self = this;
  element_to_edit = $('#module_editable_space');

  element_to_edit_html =  'TITLE: <br /><input type="text" class="app_title email_title" style="width:300px" id="app_title" value="" />';
  element_to_edit_html += '<p></p>';
  element_to_edit_html += 'VERSION: <br /><input type="text" class="app_version email_title" style="width:300px" id="app_version" value="" />';
  element_to_edit_html += '<p></p>';
  element_to_edit_html += 'DESCRIPTION: <br /><textarea class="app_description email_description" style="width:300px; height:150px" id="app_description" name="app_description"></textarea>';
  element_to_edit_html += '<p></p>';
  element_to_edit_html += '<input type="hidden" name="app_attachments" id="app_attachments">';
  element_to_edit_html += '<div id="app-file-wrap">';
  element_to_edit_html += '<div id="app-file-upload-shim" class="app-addfile">Attach Application</div></div>';
  //element_to_edit_html += '<style type="text/css"> .app-addfile { clear: both;  max-width: 140px;   color: #ffffff;   background-color: #d14836; text-align: center;  line-height: 29px;  font-weight: bold;  background-image: linear-gradient(to bottom, #dd4b39, #d14836); border: 1px solid #b0281a; cursor: pointer; } .add-addfile:hover {  background-image: linear-gradient(to bottom, #dd4b39, #c53727);  border: 1px solid #b0281a; } #app-file-wrap {  position: relative;  overflow: hidden;   display: inline-block;  min-width: 150px;  margin-top: 5px;  height: 30px;}</style>';


  element_to_edit.html(element_to_edit_html);
  $('#app_attachments').val("unset");

  var files = {};
  var filecount = 0;
  var pfile = document.createElement('input');
  pfile.type = 'file';
  pfile.setAttribute('id', 'app_attachment');
  pfile.setAttribute('name', 'app_attachment');
  $('#app-file-wrap').append(pfile);

  $('#app_attachment').on('change', function() {
    var file_details = {};
    var upload = this.files[0];
    var file_name = document.createElement('div');
    file_name.setAttribute('class', 'file-upload');
    file_name.setAttribute('accessKey', filecount);
    $('.fancybox-inner').height($('.fancybox-inner').height() + 30);
    file_name.innerHTML = upload.name;
    file_name.addEventListener('click', function() {
      this.remove(this);
      delete files[this.accessKey];
      $('.fancybox-inner').height($('.fancybox-inner').height() - 30);
      $('#app_attachments').val(JSON.stringify(files));
    });
    element_to_edit.append(file_name);
    file_details.name = upload.name;
    file_details.size = upload.size;
    var code = "no content"
    var p = new Promise(function(resolve) {
      var reader = new FileReader();
      reader.onload = function() {
        code = reader.result;
        resolve(file_details.data = code);
        files[filecount] = file_details;
        $('#app_attachments').val(JSON.stringify(files));
        filecount += 1;
      };
      reader.readAsDataURL(upload);
    });
    this.value = "";
  });


}
AppStore.prototype.formatEmailTransaction = function formatEmailTransaction(tx, app) {

  // always set the message.module to the name of the app
  tx.transaction.msg.module                = this.name;
  tx.transaction.msg.request               = "upload module";
  tx.transaction.msg.title                 = $('#app_title').val();
  tx.transaction.msg.description           = $('#app_description').val();
  tx.transaction.msg.version               = $('#app_version').val();
  tx.transaction.msg.attachments           = $('#app_attachments').val();

  return tx;

}





//////////////////
// Confirmation //
//////////////////
AppStore.prototype.onConfirmation = function onConfirmation(blk, tx, conf, app) {

  if (app.BROWSER == 1) {

    //
    // if this confirmation is mine, send myself an email
    //
    if (conf == 0) {
      if (tx.transaction.from[0].add == app.wallet.returnPublicKey()) {
        if (app.modules.returnModule("Email") != null) {

          var newtx = app.wallet.createUnsignedTransaction(app.wallet.returnPublicKey(), 0.0, 0.0);
          if (newtx == null) { return; }
          newtx.transaction.msg.module  = "Email";
          newtx.transaction.msg.title   = "Saito Application Submitted";
          newtx.transaction.msg.data    = "You have broadcast your application into the Saito Application Network.";
          newtx = app.wallet.signTransaction(newtx);
          app.archives.saveTransaction(newtx);
          if (app.modules.returnModule("Email") != null) {
            app.modules.returnModule("Email").addMessageToInbox(newtx, app);
          }
        }
      }
    }
    return;
  }








  // first confirmation
  if (conf == 0) {

    var myappstore = app.modules.returnModule("AppStore");
console.log("HERE WE ARE!");

    var txmsg = tx.returnMessage();

console.log(JSON.stringify(txmsg));

    // app submission
    if (txmsg.request == "upload module") {

console.log("HWA2");

      var app_id      = "";
      var publisher   = tx.transaction.from[0].add;
      var title       = txmsg.title;
      var description = txmsg.description;
      var version     = txmsg.version;

console.log("uploading: " + app_id + " -- " + publisher + " - " + title + " - " + description + " - " + version);
console.log(JSON.stringify(tx));

      // insert application
      var sql    = "INSERT INTO mod_appstore_apps (app_id, publisher, title, description, version, tx) VALUES ($app_id, $publisher, $title, $description, $version, $tx)";
      var params = {
        $app_id      : app_id,
        $publisher   : publisher,
        $title       : title,
	$description : description,
	$version     : version,
        $tx          : JSON.stringify(tx.transaction)
      }
console.log(sql);
console.log(params);
      app.storage.db.run(sql, params, function(err) {
console.log("SUCESSFUL INSERTION INTO DATABASE");
      });
    }
  }
}




AppStore.prototype.returnIndexPageHead = function returnIndexPageHead() {

  var html = '<html> \
  <head> \
  <meta charset="utf-8"> \
  <meta http-equiv="X-UA-Compatible" content="IE=edge"> \
  <meta name="viewport" content="width=device-width, initial-scale=1"> \
  <title>Saito AppStore:</title> \
  <script type="text/javascript" src="/jquery/jquery-3.2.1.min.js"></script> \
  <link rel="stylesheet" href="/jquery/jquery-ui.min.css" type="text/css" media="screen" /> \
  <script type="text/javascript" src="/jquery/jquery-ui.min.js"></script> \
  <link rel="stylesheet" type="text/css" href="/appstore/style.css" /> \
  </head> \
  <body> \
  <div id="Advert_browser_active"></div> \
  <div class="header"> \
    <a href="/" style="text-decoration:none;color:inherits"> \
      <img src="/img/saito_logo_black.png" style="width:35px;margin-top:5px;margin-left:25px;margin-right:10px;float:left;" /> \
      <div style="font-family:Georgia;padding-top:5px;font-size:1.2em;color:#444;">saito app store</div> \
    </a> \
  </div> \
  <div class="main" class="main"> \
    <table> \
  ';

  return html;

}
AppStore.prototype.returnIndexPageRow = function returnIndexPageRow(row) {

  return ' \
    <tr> \
      <td>'+row.title+'</td> \
      <td>'+row.description+'</td> \
      <td>'+row.version+'</td> \
    </tr> \
';

}
AppStore.prototype.returnIndexPageTail = function returnIndexPageTail() {

  return ' \
    </table> \
  </div> \
  </body> \
  </html> \
';

}









