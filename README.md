# Circle

A private home for your friend group to chat, make plans, see who is free, and keep shared memories.

This repository contains the original Circle browser prototype. The visual design stays with the first warm, card-based layout: left navigation, a focused group conversation, and a right rail for plans, availability, promises, and the Daily Drop.

## Run it

No build step or package installation is required.

1. Download or clone this repository.
2. Open `index.html` in a modern browser, or serve the repository with any static web host.
3. Changes are stored in the current browser when local storage is available. Use **Settings → Export my data** to keep a JSON copy.

## Included in the prototype

- Today dashboard, friend-group chat, plans board, Memory Vault, activities, circle details, and settings.
- Local demo messages, message reactions, replies, quiet replies, and image attachments (up to 5 MB).
- Catch-up card, plans with voting and RSVPs, commitments, availability, Daily Drop, Group Pulse, Friend Quests, and rituals.
- Search across demo messages and memories.
- Invite link preview, browser data export, and demo-data reset.
- Responsive layouts for desktop, tablet, and mobile.

## Prototype boundaries

This is a front-end prototype, not a live multi-user chat service. Data is local to one browser and is not synchronized between friends or devices.

The following still need a real backend or media service: account authentication, invite validation, real-time cross-device messaging, actual push notifications, voice/video/screen-share rooms, voice recording and transcription, AI catch-up summaries, and end-to-end encryption.

Do not treat the sample invite link, sample availability, seeded friends, or sample activity responses as live service data.

## Current UI and reliability fixes

- Opens the conversation at the newest message.
- Keeps the mobile chat composer above the bottom navigation while the message history scrolls independently.
- Prevents horizontal overflow at common phone widths.
- Makes global search submit by Enter or its visible submit control and allows memory results to open in the Memory Vault.
- Adds a clipboard fallback for invite copying.
- Handles unavailable browser storage and malformed saved data without breaking the interface.
- Escapes user-entered content before rendering it as HTML.
- Adds modal dialog semantics, focus handling, Escape-to-close, and visible keyboard focus.
- Uses local calendar dates for date fields and safely handles missing or invalid stored dates.

## Next step

Connect the prototype to Firebase or Supabase for authentication, persistent circle data, and real-time messaging. Add a dedicated WebRTC service for live rooms and a reviewed encryption implementation before calling it a private, end-to-end encrypted messaging service.
