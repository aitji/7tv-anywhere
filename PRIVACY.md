# Privacy Policy for 7TV Anywhere

**Effective date:** July 24, 2026  
**Last updated:** July 24, 2026

7TV Anywhere is developed and maintained by aitji ("7TV Anywhere," "we," "us," or "our"). This Privacy Policy explains how the 7TV Anywhere browser extension (the "Extension") handles information.

## 1. Summary

7TV Anywhere is designed to operate primarily on your device. The Extension:

- does not require an account;
- does not contain advertising or analytics;
- does not sell personal information;
- does not upload webpage text, messages, or text-field contents to us;
- does not record your browsing history or keystrokes; and
- does not operate a developer-controlled server that receives Extension user data.

The Extension processes webpage content locally to display 7TV emotes and provide emote autocomplete. It makes limited network requests to third-party services when necessary to retrieve emote data, resolve channel identifiers, download compatibility rules, and check for Extension updates.

## 2. Information Handled by the Extension

### 2.1 Website content

The Extension reads text displayed on supported webpages to recognize emote names and replace them visually with corresponding emote images. It also observes compatible text fields while you type to provide emote autocomplete.

This processing occurs locally in your browser. Raw website text, personal communications, and text-field contents are not transmitted to us or to third parties by the Extension, and the Extension does not persist a copy of this content. When the Extension displays an emote, your browser requests the corresponding image from 7TV's content-delivery service. That request identifies the public emote image being displayed but does not include the surrounding webpage text.

### 2.2 Current website

When you open the Extension popup, the Extension reads the active tab's URL or hostname to determine whether 7TV Anywhere is supported or enabled on that website. The Extension may store hostnames that you explicitly enable or disable in its local settings. It does not create or retain a general history of websites you visit.

### 2.3 Settings and cached data

The Extension stores information locally using the browser's extension storage, including:

- enabled channels and 7TV emote sets;
- channel and emote preferences;
- excluded emotes and websites;
- display, matching, and update-check preferences;
- cached emote data and compatibility rules;
- update and loading status; and
- unfinished configuration changes.

This information remains in your browser and is used only to provide the Extension's features. If you use the export feature, the selected settings are written to a file on your device at your direction. Imported settings files are read and processed locally.

### 2.4 Channel and emote-set identifiers

When you add or refresh a Twitch channel or 7TV emote set, the channel name, channel identifier, or emote-set identifier you provide may be sent to 7TV or DecAPI to locate the requested public emote data. These identifiers are used only to perform the request you initiated or to keep an enabled set current.

### 2.5 Technical request information

Like ordinary website requests, requests made to third-party services may automatically disclose technical information such as your IP address, browser user agent, request time, and requested resource to the service receiving the request. We do not receive or control this information.

## 3. Third-Party Services

The Extension may communicate with:

- **7TV (`7tv.io` and 7TV content-delivery domains):** to retrieve public channel, emote-set, emote metadata, and emote images;
- **DecAPI (`decapi.me`):** to resolve a Twitch channel name to its public Twitch identifier; and
- **jsDelivr (`cdn.jsdelivr.net`):** to retrieve 7TV Anywhere compatibility rules and publicly available update information.

These services process requests under their own terms and privacy practices. 7TV Anywhere does not control their systems or retention practices. Except for the public channel or emote-set identifiers described above and the emote-image request necessary to display a selected emote, the Extension does not send raw webpage text, text-field contents, stored settings, or a list of visited websites to these services.

## 4. How Information Is Used

Information handled by the Extension is used solely to:

- identify and display 7TV emotes;
- provide emote autocomplete;
- retrieve and maintain user-selected emote sets;
- apply website compatibility and enablement choices;
- save and restore Extension preferences;
- report loading, saving, and update status; and
- maintain the security, reliability, and functionality of the Extension.

We do not use information for advertising, profiling, creditworthiness, lending, or unrelated purposes.

## 5. Disclosure and Sale of Information

We do not sell, rent, trade, or otherwise monetize user data.

The Extension transmits only the limited request information described in Sections 2 and 3 to third-party services where necessary to provide its features. We do not otherwise disclose user data, except if required by applicable law or necessary to protect the security and integrity of the Extension.

## 6. Data Retention and User Control

Locally stored Extension settings and cached data remain in your browser until they are changed, cleared, or removed. You may:

- change or discard settings through the Extension popup;
- export or import supported settings;
- clear Extension data through your browser's extension settings; or
- delete locally stored Extension data by uninstalling the Extension.

Because we do not maintain a user account or developer-controlled database of Extension user data, we generally have no user record to access, correct, export, or delete on your behalf.

## 7. Security

The Extension uses encrypted HTTPS connections for its external requests. We limit permissions and network access to those reasonably necessary for the Extension's stated purpose. No method of software operation or electronic transmission is completely secure, and we cannot guarantee absolute security.

## 8. Remote Code

The Extension does not download or execute remote JavaScript or WebAssembly. Compatibility rules, version information, emote metadata, and emote images obtained from third-party services are treated as data and are not executed as code.

## 9. Chrome Web Store Limited Use Disclosure

7TV Anywhere's use of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

In particular, the Extension's use and transfer of information is limited to providing or improving its single, user-facing purpose; information is not used for personalized advertising; and user data is not made available for human review except where the user gives explicit consent for support, where required for security or legal compliance, or where otherwise permitted by applicable policy and law.

## 10. Children's Privacy

The Extension is not directed specifically to children and does not knowingly collect personal information from children. Because the Extension has no account system or developer-operated collection service, we do not attempt to determine a user's age.

## 11. Changes to This Policy

We may update this Privacy Policy to reflect changes to the Extension, third-party services, legal requirements, or our practices. Material changes will be reflected by updating the date at the top of this document and, where required, by providing additional notice.

## 12. Contact

Questions or concerns about this Privacy Policy may be submitted through the project's public issue tracker:

GitHub: <https://github.com/aitji/7tv-anywhere/issues>\
Email: <me@aitji.xyz>