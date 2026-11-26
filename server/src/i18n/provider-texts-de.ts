/**
 * German texts of the built-in providers, keyed by their English text: sign-in flow labels, step
 * texts and form field titles and descriptions. UI terms follow `docs/glossary.md`. The provider
 * test fails for a text missing here.
 */
// Pairs, not an object: the pre-commit hook would take a key named after a credential for one.
export const PROVIDER_TEXTS_DE: Readonly<Record<string, string>> = Object.fromEntries([
  // Shared
  ["No sign-in", "Keine Anmeldung"],
  ["Username and password", "Benutzername und Passwort"],
  ["API key", "API-Schlüssel"],
  ["Sign in", "Anmelden"],
  // Actions
  ["Import history", "Verlauf importieren"],
  ["Read old emails again", "Alte E-Mails erneut lesen"],
  [
    "Reads this inbox's emails of the chosen number of days again, so past orders, parcels and returns appear.",
    "Liest die E-Mails dieses Postfachs der gewählten Anzahl Tage erneut, damit frühere Bestellungen, Pakete und Rücksendungen erscheinen.",
  ],
  [
    "This reads many emails again, slowly. Parcels it finds are stored as history.",
    "Dies liest viele E-Mails erneut, langsam. Gefundene Pakete werden als Verlauf gespeichert.",
  ],
  ["Days to read again", "Tage, die erneut gelesen werden"],
  ["How far back emails are read again.", "Wie weit zurück E-Mails erneut gelesen werden."],
  [
    "Reads the demo parcels again, one page at a time.",
    "Liest die Demo-Pakete erneut, Seite für Seite.",
  ],
  [
    "Reads every order on the account, back to the first one, and keeps it as history.",
    "Liest jede Bestellung des Kontos bis zur ersten und behält sie als Verlauf.",
  ],
  [
    "This reads your whole order history, slowly. It can take hours.",
    "Das liest deinen ganzen Bestellverlauf, langsam. Es kann Stunden dauern.",
  ],
  ["Your orders", "Deine Bestellungen"],
  ["Oldest year", "Ältestes Jahr"],
  [
    "Leave empty to read back to the first order.",
    "Leer lassen, um bis zur ersten Bestellung zu lesen.",
  ],
  ["Sign in in your browser", "Im Browser anmelden"],
  [
    "Open the address, sign in, and paste the full address your browser ends on.",
    "Die Adresse öffnen, anmelden und die vollständige Adresse einfügen, auf der dein Browser landet.",
  ],
  ["Username", "Benutzername"],
  ["Password", "Passwort"],
  ["Email", "E-Mail"],
  ["E-mail address", "E-Mail-Adresse"],
  ["Phone number", "Telefonnummer"],
  ["Phone number (hashed)", "Telefonnummer (gehasht)"],
  ["Access token", "Zugriffstoken"],
  ["Refresh token", "Aktualisierungstoken"],
  ["Time zone", "Zeitzone"],
  ["Country", "Land"],
  ["Language", "Sprache"],
  ["Postcode", "Postleitzahl"],
  ["Market", "Markt"],
  // Inbox (IMAP)
  ["IMAP server", "IMAP-Server"],
  ["For example imap.example.org.", "Zum Beispiel imap.example.org."],
  ["Port", "Port"],
  ["Use TLS", "TLS verwenden"],
  [
    "Off: the connection must switch to TLS with STARTTLS, usually on port 143.",
    "Aus: Die Verbindung muss mit STARTTLS auf TLS wechseln, meist auf Port 143.",
  ],
  ["Allow an unencrypted connection", "Unverschlüsselte Verbindung erlauben"],
  [
    "Only with TLS off: connect even when the server offers no STARTTLS. Sends the password in clear text.",
    "Nur ohne TLS: auch verbinden, wenn der Server kein STARTTLS anbietet. Das Passwort geht im Klartext über die Leitung.",
  ],
  ["Folders", "Ordner"],
  ["Days to look back on the first sync", "Tage, die die erste Synchronisierung zurückblickt"],
  ["Check senders (DKIM/DMARC)", "Absender prüfen (DKIM/DMARC)"],
  [
    "Off only if your mail server adds no Authentication-Results header: emails then reach a shop's or carrier's provider by the sender's domain alone, which a forged sender can fake.",
    "Nur ausschalten, wenn dein Mailserver keinen Authentication-Results-Header einfügt: E-Mails erreichen den Anbieter eines Shops oder Paketdienstes dann allein über die Absenderdomain, die ein gefälschter Absender vortäuschen kann.",
  ],
  ["Yes", "Ja"],
  ["No", "Nein"],
  ["Client ID", "Client-ID"],
  ["Client secret", "Client-Secret"],
  ["Address", "Adresse"],
  ["Allow an address on your own network", "Adresse im eigenen Netzwerk erlauben"],
  [
    "On: the address may be on your own network (a LAN address). Off, such an address is refused.",
    "An: Die Adresse darf im eigenen Netzwerk liegen (eine LAN-Adresse). Aus wird eine solche Adresse abgelehnt.",
  ],
  ["Addresses", "Adressen"],
  ["Device ID", "Geräte-ID"],
  ["Device serial number", "Geräte-Seriennummer"],
  ["Device", "Gerät"],
  ["Private key", "Privater Schlüssel"],
  ["Salt", "Salt"],
  ["Subject", "Subjekt"],
  ["Cookies", "Cookies"],
  ["ID token", "ID-Token"],
  ["Role tokens", "Rollen-Tokens"],
  // Airmee
  ["Airmee account (code by text message)", "Airmee-Konto (Code per SMS)"],
  ["Country code (e.g. +46)", "Ländervorwahl (z. B. +46)"],
  [
    "The phone number Airmee delivers to. Airmee texts a code to it.",
    "Die Telefonnummer, an die Airmee zustellt. Airmee schickt einen Code per SMS dorthin.",
  ],
  // Amazon
  ["Storefront", "Shop-Land"],
  [
    "The Amazon storefront the account orders from.",
    "Die Amazon-Länderseite, bei der das Konto bestellt.",
  ],
  // Ampere
  ["Tracking links", "Verfolgungslinks"],
  [
    "The tracking links from bol.com's shipping e-mails, one per parcel.",
    "Die Verfolgungslinks aus den Versand-E-Mails von bol.com, einer pro Paket.",
  ],
  // Apple Express, Better Trucks
  [
    "Time zone of the delivery area; Apple Express times carry no offset.",
    "Zeitzone des Zustellgebiets; Zeiten von Apple Express haben keinen Versatz.",
  ],
  [
    "Time zone Better Trucks' offset-less times are read in. Defaults to UTC.",
    "Zeitzone, in der die Zeiten von Better Trucks ohne Versatz gelesen werden. Standard UTC.",
  ],
  // Aramex, BOX NOW
  ["Aramex Australia or Aramex New Zealand.", "Aramex Australien oder Aramex Neuseeland."],
  [
    "The BOX NOW country the parcels are sent in.",
    "Das BOX-NOW-Land, in dem die Pakete verschickt werden.",
  ],
  // bpost
  [
    "The recipient's postcode; bpost's tracking needs it with every barcode.",
    "Die Postleitzahl des Empfängers; die Verfolgung von bpost braucht sie zu jeder Sendungsnummer.",
  ],
  ["Language of bpost's event texts.", "Sprache der Ereignistexte von bpost."],
  // DHL
  ["Regions", "Regionen"],
  ["Account", "Konto"],
  ["DHL Netherlands account", "DHL-Konto Niederlande"],
  ["Mój DHL account", "Mój-DHL-Konto"],
  ["DHL Germany account (sign in in your browser)", "DHL-Konto Deutschland (Anmeldung im Browser)"],
  ["DHL API key (optional)", "DHL-API-Schlüssel (optional)"],
  ["DHL API key", "DHL-API-Schlüssel"],
  ["DHL Netherlands account (email and password)", "DHL-Konto Niederlande (E-Mail und Passwort)"],
  [
    "The email and password of your my.dhlecommerce.nl account.",
    "E-Mail und Passwort deines Kontos bei my.dhlecommerce.nl.",
  ],
  ["Mój DHL account (Poland, SMS code)", "Mój-DHL-Konto (Polen, SMS-Code)"],
  ["Phone number (Poland, 9 digits)", "Telefonnummer (Polen, 9 Ziffern)"],
  // DPD, Hermes, Swiss Post
  ["Public tracking", "Öffentliche Verfolgung"],
  ["Delivery window from public tracking", "Zustellzeitraum aus der öffentlichen Verfolgung"],
  ["Event history", "Ereignisverlauf"],
  // Mondial Relay, PostNord, Swiss Post
  ["Mondial Relay account (sign in in your browser)", "Mondial-Relay-Konto (Anmeldung im Browser)"],
  ["PostNord account (sign in in your browser)", "PostNord-Konto (Anmeldung im Browser)"],
  [
    "Swiss Post account (SwissID, in your browser)",
    "Konto der Schweizerischen Post (SwissID, im Browser)",
  ],
  // Paack
  ["Postcode per tracking number", "Postleitzahl je Sendungsnummer"],
  // Posten / Bring
  ["Brand", "Marke"],
  [
    "Open the address and sign in. The browser then tries to open the app; copy that posten:// or bring:// address (from the address bar or the developer tools) and paste it.",
    "Die Adresse öffnen und anmelden. Der Browser versucht danach, die App zu öffnen; diese posten://- oder bring://-Adresse (aus der Adressleiste oder den Entwicklertools) kopieren und einfügen.",
  ],
  // Posti
  ["OmaPosti (bank or mobile ID)", "OmaPosti (Bank- oder Mobil-ID)"],
  ["Mobiilivarmenne (mobile ID)", "Mobiilivarmenne (Mobil-ID)"],
  ["How do you want to identify yourself to Posti?", "Wie möchtest du dich bei Posti ausweisen?"],
  [
    "Open the address, identify yourself, and paste the address your browser ends on.",
    "Die Adresse öffnen, dich ausweisen und die Adresse einfügen, auf der dein Browser landet.",
  ],
  // PPL
  ["Sign in with an e-mailed PIN", "Mit einer PIN per E-Mail anmelden"],
  [
    "PPL e-mails a PIN to this address. Signing in here signs the app out.",
    "PPL schickt eine PIN an diese Adresse. Die Anmeldung hier meldet die App ab.",
  ],
  // Universal lookup
  [
    "Address of the universal-lookup service, for example https://lookup.example.com",
    "Adresse des Universal-Lookup-Dienstes, zum Beispiel https://lookup.example.com",
  ],
  // USPS
  [
    "USPS Informed Delivery (username, password and verification)",
    "USPS Informed Delivery (Benutzername, Passwort und Bestätigung)",
  ],
  ["USPS username", "USPS-Benutzername"],
  ["Consumer key", "Consumer-Key"],
  ["Consumer secret", "Consumer-Secret"],
  ["Informed Delivery", "Informed Delivery"],
  ["Approve the sign-in on your phone.", "Die Anmeldung auf deinem Telefon bestätigen."],
  // Vinted Go
  ["Vinted Go account (emailed sign-in link)", "Vinted-Go-Konto (Anmeldelink per E-Mail)"],
  [
    "The email address of your Vinted Go account. Vinted Go sends a link to it.",
    "Die E-Mail-Adresse deines Vinted-Go-Kontos. Vinted Go schickt einen Link dorthin.",
  ],
  // Consumers (docs/consumers.md)
  ["Server", "Server"],
  [
    "The ntfy server, e.g. https://ntfy.example.com.",
    "Der ntfy-Server, z. B. https://ntfy.example.com.",
  ],
  ["Topic", "Thema"],
  ["The topic to publish to.", "Das Thema, an das gesendet wird."],
  ["Priority", "Priorität"],
  ["1 (min) to 5 (max).", "1 (niedrigste) bis 5 (höchste)."],
  ["For a server or topic that needs one.", "Für einen Server oder ein Thema, das eines verlangt."],
  ["The address that receives the POST.", "Die Adresse, die den POST empfängt."],
  ["Signing secret", "Signaturgeheimnis"],
  [
    "Shared secret for the HMAC-SHA256 signature; at least 16 characters.",
    "Gemeinsames Geheimnis für die HMAC-SHA256-Signatur; mindestens 16 Zeichen.",
  ],
  [
    "The apprise-api server, e.g. http://apprise:8000.",
    "Der apprise-api-Server, z. B. http://apprise:8000.",
  ],
  ["Configuration key", "Konfigurationsschlüssel"],
  [
    "Key of a configuration saved in apprise-api; leave empty to send Apprise URLs.",
    "Schlüssel einer in apprise-api gespeicherten Konfiguration; leer lassen, um Apprise-URLs zu senden.",
  ],
  ["Apprise URLs", "Apprise-URLs"],
  [
    "One per line, used when no configuration key is set.",
    "Eine pro Zeile, verwendet, wenn kein Konfigurationsschlüssel gesetzt ist.",
  ],
  ["SMTP server", "SMTP-Server"],
  ["e.g. smtp.example.com", "z. B. smtp.example.com"],
  ["Security", "Sicherheit"],
  [
    "starttls (port 587), tls (port 465) or none (a server on your own network).",
    "starttls (Port 587), tls (Port 465) oder none (ein Server im eigenen Netz).",
  ],
  ["From", "Absender"],
  ["Sender address.", "Absenderadresse."],
  ["To", "Empfänger"],
  ["Who receives the emails.", "Wer die E-Mails bekommt."],
] satisfies [string, string][]);
