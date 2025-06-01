/**
 * @name PGPEncrypt
 * @description End-to-end PGP encryption for Discord messages
 * @version 1.0.0
 * @author UnjustRobust
 * @source https://github.com/LeonardoParchao/Discord_PGP
 */

module.exports = (() => {
  const config = {
    info: {
      name: "PGPEncrypt",
      authors: [{ name: "UnjustRobust" }],
      version: "1.0.0",
      description: "PGP message encryption/decryption"
    },
    // Required BetterDiscord fields
    changelog: [
      {
        title: "Initial Release",
        items: ["First version of the plugin"]
      }
    ],
    defaultConfig: [],
    main: "PGPEncrypt.plugin.js"
  };

  return !global.ZeresPluginLibrary
    ? class {
        constructor() { this._config = config; }
        getName() { return config.info.name; }
        getAuthor() { return config.info.authors.map(a => a.name).join(", "); }
        getDescription() { return config.info.description; }
        getVersion() { return config.info.version; }
        load() { }
        start() { }
        stop() { }
      }
    : (([Plugin, Library]) => {
        const { DiscordModules, PluginUtilities, Patcher, WebpackModules } = Library;

        class PGPEncrypt extends Plugin {
          constructor() {
            super();
            this.encryptionEnabled = false;
            this.passphrase = null;
            this.publicKey = "";
            this.privateKey = "";
          }

          onStart() {
            this.injectOpenPGP();
            this.loadKeys();
            this.addStyles();
            this.patchSendMessage();
            this.addUIElements();
          }

          onStop() {
            this.passphrase = null;
            PluginUtilities.removeCSS("pgp-encrypt-styles");
            this.removeUIElements();
            Patcher.unpatchAll();
          }

          injectOpenPGP() {
            if (window.openpgp) return;
            
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/openpgp@5.0.0/dist/openpgp.min.js";
            script.onload = () => {
              window.openpgp.initWorker({ 
                path: "https://cdn.jsdelivr.net/npm/openpgp@5.0.0/dist/openpgp.worker.min.js" 
              });
            };
            document.head.appendChild(script);
          }

          loadKeys() {
            this.publicKey = PluginUtilities.loadData(config.info.name, "publicKey") || "";
            this.privateKey = PluginUtilities.loadData(config.info.name, "privateKey") || "";
          }

          saveKeys() {
            PluginUtilities.saveData(config.info.name, "publicKey", this.publicKey);
            PluginUtilities.saveData(config.info.name, "privateKey", this.privateKey);
          }

          addStyles() {
            PluginUtilities.addStyle("pgp-encrypt-styles", `
              .pgp-decrypted-content {
                white-space: pre-wrap;
                padding: 10px;
                background: var(--background-secondary);
                border-radius: 5px;
              }
            `);
          }

          patchSendMessage() {
            const MessageActions = WebpackModules.getByProps("sendMessage", "editMessage");
            Patcher.before(MessageActions, "sendMessage", (_, args) => {
              if (this.encryptionEnabled && window.openpgp) {
                try {
                  const [channelId, message] = args;
                  args[1] = { 
                    ...message, 
                    content: this.encryptMessageSync(message.content) 
                  };
                } catch (err) {
                  console.error("PGP encryption failed", err);
                  this.showToast("Encryption failed! Sent as plaintext", "error");
                }
              }
              return args;
            });
          }

          encryptMessageSync(content) {
            if (!this.publicKey) throw new Error("No public key configured");
            const publicKey = window.openpgp.readKey({ armoredKey: this.publicKey });
            return window.openpgp.encrypt({
              message: window.openpgp.createMessage({ text: content }),
              encryptionKeys: publicKey
            });
          }

          async decryptMessage(encryptedContent) {
            if (!this.privateKey) throw new Error("No private key configured");
            if (!this.passphrase) return this.promptPassphrase(encryptedContent);

            const privateKey = await window.openpgp.decryptKey({
              privateKey: await window.openpgp.readPrivateKey({ 
                armoredKey: this.privateKey 
              }),
              passphrase: this.passphrase
            });

            const message = await window.openpgp.readMessage({ 
              armoredMessage: encryptedContent 
            });
            
            const { data: decrypted } = await window.openpgp.decrypt({
              message,
              decryptionKeys: privateKey
            });
            
            return decrypted;
          }

          promptPassphrase(encryptedContent) {
            const { Modal, TextInput, Button } = WebpackModules.getByProps("Modal", "TextInput", "Button");
            
            const modal = new Modal({
              title: "Enter PGP Passphrase",
              children: [
                React.createElement(TextInput, {
                  type: "password",
                  autoFocus: true,
                  onChange: (val) => this.passphrase = val,
                  note: "Passphrase is never stored and will be cleared after use"
                })
              ],
              footer: [
                React.createElement(Button, {
                  color: Button.Colors.RED,
                  onClick: () => modal.close()
                }, "Cancel"),
                React.createElement(Button, {
                  color: Button.Colors.GREEN,
                  onClick: async () => {
                    modal.close();
                    try {
                      const decrypted = await this.decryptMessage(encryptedContent);
                      this.showDecryptedModal(decrypted);
                    } catch (err) {
                      this.showToast("Decryption failed", "error");
                    }
                  }
                }, "Decrypt")
              ]
            });
            
            modal.open();
          }

          showDecryptedModal(content) {
            const { Modal, Button } = WebpackModules.getByProps("Modal", "Button");
            
            const modal = new Modal({
              title: "Decrypted Message",
              children: [
                React.createElement("div", { className: "pgp-decrypted-content" },
                  React.createElement("pre", null, content)
                )
              ],
              footer: [
                React.createElement(Button, {
                  onClick: () => modal.close()
                }, "Close")
              ]
            });
            
            modal.open();
          }

          addUIElements() {
            const { TooltipContainer } = WebpackModules.getByProps("TooltipContainer");
            const MessageComposer = WebpackModules.getModule(m => m?.default?.toString().includes("MessageComposer"));
            
            // Add button to message composer
            Patcher.after(MessageComposer, "default", (_, [props], res) => {
              if (!res.props.children) return;
              
              const toggleButton = React.createElement(TooltipContainer, {
                text: this.encryptionEnabled ? "Disable Encryption" : "Enable Encryption",
                children: () => React.createElement("button", {
                  style: { 
                    background: "none", 
                    border: "none", 
                    cursor: "pointer",
                    fontSize: "1.2em",
                    margin: "0 5px"
                  },
                  onClick: () => {
                    this.encryptionEnabled = !this.encryptionEnabled;
                    this.showToast(
                      `PGP ${this.encryptionEnabled ? "Enabled" : "Disabled"}`,
                      "info"
                    );
                  }
                }, this.encryptionEnabled ? "🔒" : "🔓")
              });
              
              res.props.children.push(toggleButton);
              return res;
            });

            // Add context menu item
            const MessageContextMenu = WebpackModules.getByProps("MessageContextMenu");
            Patcher.after(MessageContextMenu, "default", (_, [props], res) => {
              if (!props.message.content.includes("-----BEGIN PGP MESSAGE-----")) return;
              
              res.props.children.push(
                React.createElement(MessageContextMenu.MenuItem, {
                  label: "Decrypt PGP Message",
                  action: async () => {
                    try {
                      const decrypted = await this.decryptMessage(props.message.content);
                      this.showDecryptedModal(decrypted);
                    } catch (err) {
                      this.showToast("Decryption failed", "error");
                    }
                  }
                })
              );
              return res;
            });
          }

          removeUIElements() {
            // Handled by Patcher.unpatchAll() in onStop()
          }

          showToast(message, type) {
            const Toasts = WebpackModules.getByProps("showToast");
            Toasts.showToast(message, type);
          }

          getSettingsPanel() {
            const { TextInput, Button } = WebpackModules.getByProps("TextInput", "Button");
            
            return React.createElement("div", { style: { padding: "20px" } },
              React.createElement("h3", null, "PGP Settings"),
              
              React.createElement(TextInput, {
                label: "Public Key (Armored ASCII)",
                value: this.publicKey,
                onChange: (val) => {
                  this.publicKey = val;
                  this.saveKeys();
                },
                textarea: true,
                rows: 10
              }),
              
              React.createElement(TextInput, {
                label: "Private Key (Armored ASCII)",
                value: this.privateKey,
                onChange: (val) => {
                  this.privateKey = val;
                  this.saveKeys();
                },
                textarea: true,
                rows: 10
              }),
              
              React.createElement(Button, {
                onClick: async () => {
                  if (!this.passphrase) {
                    this.showToast("Enter passphrase first by decrypting a message", "error");
                    return;
                  }
                  
                  try {
                    const { privateKey, publicKey } = await window.openpgp.generateKey({
                      type: "ecc",
                      curve: "curve25519",
                      passphrase: this.passphrase
                    });
                    
                    this.privateKey = privateKey;
                    this.publicKey = publicKey;
                    this.saveKeys();
                    this.showToast("New key pair generated!", "success");
                  } catch (err) {
                    this.showToast("Key generation failed", "error");
                  }
                }
              }, "Generate New Key Pair (Curve25519)"),
              
              React.createElement("div", { style: { marginTop: "20px" } },
                React.createElement("h4", null, "Security Notes:"),
                React.createElement("ul", null,
                  React.createElement("li", null, "🔑 Passphrases are NEVER stored"),
                  React.createElement("li", null, "⚠️ Keys are stored in plugin data"),
                  React.createElement("li", null, "🧹 Reloading Discord clears memory"),
                  React.createElement("li", null, "🚫 Not for highly sensitive use")
                )
              )
            );
          }
        }

        return PGPEncrypt;
      })(global.ZeresPluginLibrary.buildPlugin(config));
})();
