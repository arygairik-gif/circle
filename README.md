# Circle

Circle keeps the original warm, card-based design and now uses Firebase Authentication and Cloud Firestore for its live account and group features.

## Live features
- Email/password accounts and Google sign-in.
- Create multiple private circles and switch between them.
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
5. Publish `firestore.rules` (Firestore → Rules) or deploy using the Firebase CLI.
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

## Still not live
Image/file uploads and voice notes still need Firebase Storage plus recording/playback UI. Voice/video rooms need a separate real-time media service such as LiveKit. Push notifications need FCM setup, a service worker and web-push configuration. AI catch-up needs a secure server-side AI integration. Some decorative counters, awards, sample prompts and room UI remain demo content.

**Security:** Firebase Auth + Firestore rules provide authenticated access control, not end-to-end encryption. Do not describe Circle as E2EE. Add App Check, abuse controls, rate limits, retention/deletion workflows and a security review before wider use.
