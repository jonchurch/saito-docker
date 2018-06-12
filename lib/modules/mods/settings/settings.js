var saito = require('../../../saito');
var ModTemplate = require('../../template');
var util = require('util');


//////////////////
// CONSTRUCTOR  //
//////////////////
function Settings(app) {

  if (!(this instanceof Settings)) { return new Settings(app); }

  Settings.super_.call(this);

  this.app             = app;

  this.name            = "Settings";
  this.browser_active  = 0;
  this.handlesEmail    = 1;
  this.emailAppName    = "Settings";

  return this;

}
module.exports = Settings;
util.inherits(Settings, ModTemplate);






////////////////////////////////
// Email Client Interactivity //
////////////////////////////////
Settings.prototype.displayEmailForm = function displayEmailForm(app) {

  element_to_edit = $('#module_editable_space');

  element_to_edit_html = `
    <div id="module_instructions" class="module_instructions">
      <p></p>
      <b style="font-size:1.2em">Network Settings:</b>
      <p></p>
      <div style="font-size:0.85em;margin-left:20px">
        <div class="courier"><b>Public Key:</b></div>
        <div class="courier">${app.wallet.returnPublicKey()}</div>
        <p></p>
        <div class="courier"><b>Private Key:</b></div>
        <div class="courier">${app.wallet.returnPrivateKey()}</div>
        <p></p>
        <div class="courier"><b>Address:</b></div>
        <div class="courier">${app.wallet.returnIdentifier() || "no address registered"}</div>
      </div>
      <p></p>
      <b style="font-size:1.2em">Fee Preference:</b>
      <p></p>
      <div style="font-size:0.85em;margin-left:20px">
        Transactions with higher fees are confirmed faster:
        <p></p>
        <input type="range" id="feerange" class="feerange" min="0.001" value="${app.wallet.returnDefaultFee()}" max="2" step="0.001" style="width:400px" oninput="updateFeeDisplay(value)" >
        <output for="feerange" id="feedisplay" style="margin-left:20px;font-size:0.9em;padding-bottom:3px;">${app.wallet.returnDefaultFee()}</output>
      </div>
      <p></p>
      <b style="font-size:1.2em">Advanced Options:</b>
      <div style="font-size:0.85em;margin-left:20px">
        <input type="button" id="save_wallet" class="settings_button save_wallet" value="Backup Wallet" />
        <input type="button" id="save_messages" class="settings_button save_messages" value="Backup Inbox" />
        <input type="button" id="import_wallet" class="settings_button import_wallet" value="Import Wallet" />
        <input type="button" id="import_messages" class="settings_button import_messages" value="Import Inbox" />
        <input type="button" id="reset_button" class="settings_button reset_button" value="Reset Account" />
        <input type="button" id="restore_privatekey" class="settings_button restore_privatekey" value="Restore Wallet from Private Key" />
        <input id="file-input" class="file-input" type="file" name="name" style="display:none;" />
      </div>
      <p></p>
      <div style="display:none" id="restore_privatekey_div" class="restore_privatekey_div">
        <label for="restore_privatekey_input">Your Private Key:</label>
        <br />
        <input type="text" name="restore_privatekey_input" id="restore_privatekey_input" class="restore_privatekey_input" />
        <br />
        <input type="submit" id="restore_privatekey_submit" value="Import Private Key" class="restore_privatekey_submit" />
        <p style="clear:both;margin-top:30px;"></p>
      </div>
     <div class="dns_info" id="dns_info">
     <b>DNS Information</b>
     <p></p>
     You are trusting the following DNS servers.
     <div class="dns_servers" id="dns_servers">
       <table id="dns_servers_table" class="dns_servers_table" style="margin-left: 25px">
         <tr>
           <th style="padding-right:25px;" align="left">Domain</th>
           <th style="padding-right:25px;" align="left">Server</th>
           <th style="padding-right:25px;" align="left">Public Key</th>
         </tr>
       </table>
     </div>
     <p></p>
     </div>
   </div>
   <style type="text/css">
     .courier {
       font-family: "Courier New", Courier, "Lucida Sans Typewriter", "Lucida Typewriter", monospace;
     }
     .module_instructions {
       padding: 12px;
       max-width: 480px;
       border: 1px dashed #f7f7f7;
       word-wrap: break-word;
     }
     .settings_button {
       padding-left: 10px;
       padding-right: 10px;
       padding-top: 6px;
       padding-bottom: 6px;
       font-size: 1.2em;
       margin-bottom: 10px;
     }
   </style>
   <script type="text/javascript">
      function updateFeeDisplay(vol) {
        document.querySelector("#feedisplay").value = vol;
      }
  </script>`;
  element_to_edit.html(element_to_edit_html);

  $('#module_textinput_button').off();
  $('#module_textinput_button').on('click', function() {
    var identifier_to_check = $('module_textinput').val();
    var regex=/^[0-9A-Za-z]+$/;
    if (regex.test(identifier_to_check)) {
      $('#send').click();
    } else {
      alert("Only Alphanumeric Characters Permitted");
    }
  });



  // auto-input correct address and payment amount
  $('#lightbox_compose_to_address').val(app.wallet.returnPublicKey());
  $('#lightbox_compose_payment').val(0.0);
  $('#lightbox_compose_fee').val(app.wallet.returnDefaultFee());
  $('.lightbox_compose_address_area').hide();
  $('.lightbox_compose_module').hide();
  $('#module_textinput').focus();
  $('#module_instructions').css('padding-top','4px');

  this.attachSettingsEvents(app);
}


/////////////////////
// Display Message //
/////////////////////
Settings.prototype.displayEmailMessage = function displayEmailMessage(message_id, app) {

  if (app.BROWSER == 1) {

    message_text_selector = "#" + message_id + " > .data";
    $('#lightbox_message_text').html( $(message_text_selector).html() );
    $('#lightbox_compose_to_address').val(registry_self.publickey);
    $('#lightbox_compose_payment').val(3);
    $('#lightbox_compose_fee').val(2);

  }

}





Settings.prototype.attachSettingsEvents = function attachSettingsEvents(app) {

  module_self = app.modules.returnModule("Settings");

  $('.lightbox_viewkeys_publickey').html(app.wallet.returnPublicKey());
  $('.lightbox_viewkeys_privatekey').html(app.wallet.returnPrivateKey());
  $('.lightbox_viewkeys_identifier').html(app.wallet.returnIdentifier());

  $('.restore_privatekey').off();
  $('.restore_privatekey').on('click', function() {
    $('.restore_privatekey_div').toggle();
  });


  $('.feerange').off();
  $('.feerange').on('change', function() {
    let newfee = $('.feerange').val();
    alert("\n\n\nCHANGING THE FEE: "+newfee+" \n\n\n");
    module_self.app.wallet.setDefaultFee(newfee);
  });

  $('.save_wallet').off();
  $('.save_wallet').on('click', function() {
    content    = JSON.stringify(app.options);
    var pom = document.createElement('a');
        pom.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content));
        pom.setAttribute('download', "saito.wallet.json");
        pom.click();
  });


  $('.import_wallet').off();
  $('.import_wallet').on('click', function() {
    document.getElementById('file-input').addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) { return; }
      var reader = new FileReader();
      reader.onload = function(e) {
        var contents = e.target.result;
        tmpoptions = JSON.parse(contents);
        if (tmpoptions.wallet.publicKey != null) {
          app.options = JSON.parse(contents);
          app.storage.saveOptions();
          $.fancybox.close();
          module_self.showBrowserAlert("Wallet Import Successful");
        } else {
          alert("This does not seem to be a valid wallet file");
        }
      };
      reader.readAsText(file);
    }, false);
    $('#file-input').trigger('click');
  });


  $('.save_messages').off();
  $('.save_messages').on('click', function() {
    content    = JSON.stringify(module_self.app.options);
    var pom = document.createElement('a');
        pom.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content));
        pom.setAttribute('download', "saito.messages.json");
        pom.click();
  });


  $('.import_messages').off();
  $('.import_messages').on('click', function() {
    document.getElementById('file-input').addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) { return; }
      var reader = new FileReader();
      reader.onload = function(e) {
        var contents = e.target.result;
        module_self.app.archives.resetArchives();
        tmpmessages = JSON.parse(contents);
        if (tmpmessages.messages.length != null) {
          for (xx = 0; xx < tmpmessages.length; xx++) {
            module_self.app.archives.saveMessage(tmpmessages[xx]);
          }
        } else {
          alert("Error: this is not a valid inbox backup");
        }
      };
      reader.readAsText(file);
    }, false);
    $('.file-input').trigger('click');
  });

  $('.reset_button').off();
  $('.reset_button').on('click', function() {
    module_self.app.archives.resetArchives();
    module_self.app.storage.resetOptions();
    module_self.app.storage.saveOptions();
    alert("Your account has been reset");
    location.reload();
  });


  if (module_self.app.dns.dns.domains.length == 0) {
    $('.dns_info').hide();
    return;
  } else {

    // customize dns settings display
    $('.dns_servers_table tr').empty();
    for (let c = 0; c < module_self.app.dns.dns.domains.length; c++) {
      var tmphtml = '<tr><th align="left" style="padding-right:25px;">Domain</th><th align="left" style="padding-right:25px">Host</th><th align="left">Public Key</th></tr>';
      $('.dns_servers_table').append(tmphtml);
      var dnsurl = "unknown";
      for (let cvs = 0; cvs < module_self.app.network.peers.length; cvs++) {
        if (module_self.app.dns.dns.domains[c].publickey == module_self.app.network.peers[cvs].peer.publickey) {
          dnsurl = module_self.app.network.peers[cvs].peer.host;
          tmphtml = '<tr><td>'+module_self.app.dns.dns.domains[c].domain+'</td><td>'+dnsurl+'</td><td>'+module_self.app.dns.dns.domains[c].publickey+'</td></tr>';
          $('#dns_servers_table tr:last').after(tmphtml);
        }
      }
      if (dnsurl == "unknown") {
        tmphtml = '<tr><td style="padding-right:14px;">'+module_self.app.dns.dns.domains[c].domain+'</td><td style="padding-right:14px;">UNKNOWN</td><td style="padding-right:14px;">PUBLIC KEY OUT-OF-DATE</td></tr>';
        $('.dns_servers_table tr:last').after(tmphtml);
      }
    };

  }


  $('.restore_privatekey_submit').off();
  $('.restore_privatekey_submit').on('click', function() {

    var privkey = $('#restore_privatekey_input').val();
    privkey.trim();

    var pubkey = module_self.app.crypt.returnPublicKey(privkey);

    if (pubkey != "") {
      module_self.app.dns.fetchIdFromAppropriateServer(module_self.app.wallet.returnPublicKey(), function (answer) {
        if (module_self.app.dns.isRecordValid(answer) == 0) {
          alert("Cannot find registered email address. Restoring public and private keys only");
          return;
        }

        dns_response = JSON.parse(answer);

        if (dns_response.identifier != "") {
          if (dns_response.publickey != "") {
            module_self.app.keys.addKey(dns_response.publickey, dns_response.identifier, 0, "Email");
            module_self.app.keys.saveKeys();
            module_self.app.wallet.updateIdentifier(dns_response.identifier);
            module_self.app.wallet.saveWallet();
          }
        }

        // regardless of whether we got an identifier, save
        module_self.app.wallet.wallet.utxi = [];
        module_self.app.wallet.wallet.utxo = [];
        module_self.app.wallet.wallet.privateKey = privkey;
        module_self.app.wallet.wallet.publicKey  = pubkey;

        module_self.app.options.blockchain.lastblock = 0;
        module_self.app.storage.saveOptions();
        module_self.app.wallet.saveWallet();

        alert("Your Wallet and Email Address Restored!");
        location.reload();
      });

    }
  });

}






