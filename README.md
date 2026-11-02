# Circle

Circle keeps the original warm, card-based design and now uses Firebase Authentication and Cloud Firestore for its live account and group features.

## Live features
- Email/password accounts and Google sign-in.
- Create multiple private circles and switch between them.
- Remember the last opened circle on this browser and restore it on the next visit; selecting Back to circles or signing out clears that selection.
- Random invite codes; joining requires a valid code and creates a member record.
- Live group chat across signed-in devices.
- Firestore-backed message reactions.
- Shared plans, time-option voting and RSVPs.
- Group member profiles, availability and mood check-ins.
- Firestore rules restrict circle content to authenticated members.

## Run locally
Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Open the Vite URL (normally http://localhost:5173). The Firebase web configuration for `circle-20c34` is in `src/firebase.js`. Firebase web config is public client configuration, not a server credential. Never commit a service-account JSON file or Admin SDK private key.

## One-time Firebase Console setup
1. Open Firebase project `circle-20c34`.
2. In **Authentication → Sign-in method**, enable **Email/Password** and **Google**.
3. In **Authentication → Settings → Authorized domains**, add `localhost` and the exact production hosting domain.
4. In **Firestore Database**, create a database.
5. Publish `firestore.rules` (Firestore → Rules). No Cloud Storage bucket or billing upgrade is required for the small-media mode.
6. Run Circle, create an account, then create a circle. Friends join using the generated invite code.

## Deploy
```bash
npm install -g firebase-tools
firebase login
firebase use circle-20c34
npm run build
firebase deploy --only firestore:rules,hosting
```

`firebase.json` publishes Vite's `dist/` folder.

## Data model
- `users/{uid}` and `users/{uid}/circles/{circleId}`
- `circles/{circleId}`
- `circles/{circleId}/members/{uid}`
- `circles/{circleId}/messages/{messageId}`
- `circles/{circleId}/plans/{planId}`
- `invites/{code}` (random code lookup; listing is denied)

The rules deny circle reads/writes unless the signed-in user is a member. Invite documents allow direct lookup by code, not listing. Do not replace these rules with open access rules.

## Feature status and remaining setup
- **Photos and voice notes:** compressed images (up to 300 KB before encoding) and short audio clips (up to 300 KB) are stored as data URLs in Firestore message/memory documents. This avoids Firebase Storage and a billing-plan upgrade, but it is only suitable for small, low-volume sharing. The Firestore document-size limit and daily quotas still apply. Browser microphone permission is requested only when recording starts.
- **Daily Drop:** prompts are consistent by local calendar date. Each member's answers are hidden from other members until that member has submitted their own answer; the Firestore rules enforce this.
- **Catch-up panel:** uses recent messages, plans and open commitments. It is a data-driven summary, not an AI-generated summary.
- **Group stats and awards:** counts are calculated from loaded circle data. Playlist and sticker activities currently save text contributions; they do not connect to a music service or generate sticker images.
- **Browser alerts:** can show new-message alerts while Circle is open in a background tab. True push when the site is closed still needs Firebase Cloud Messaging, a VAPID public key, a service worker and a trusted sender backend.
- **Voice/video rooms:** the room tile is still a preview. A real multi-person room needs a provider such as LiveKit and a server endpoint that issues signed room tokens. Never put media-provider API secrets in browser code.
- **AI catch-up:** not connected. It needs a secure server-side AI integration and a provider key; do not paste a private API key into `src/` or the browser.


**Security:** Firebase Auth + Firestore rules provide authenticated access control, not end-to-end encryption. Do not describe Circle as E2EE. Add App Check, abuse controls, rate limits, retention/deletion workflows and a security review before wider use.
