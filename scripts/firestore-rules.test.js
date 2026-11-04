import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';

const projectId = 'demo-circle-rules';
const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules }
});

let passed = 0;
async function allowed(label, promise) {
  await assertSucceeds(promise);
  passed += 1;
  console.log('PASS', label);
}
async function denied(label, promise) {
  await assertFails(promise);
  passed += 1;
  console.log('PASS', label);
}

const circleId = 'circle-test';
const inviteCode = 'JOINCODE123';
const future = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
const memberData = (uid, name, role = 'member') => ({
  uid,
  name,
  handle: '',
  bio: '',
  photoURL: '',
  role,
  status: 'around',
  joinedAt: Timestamp.now()
});

try {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'circles', circleId), {
      name: 'Test circle',
      ownerUid: 'owner',
      inviteCode,
      createdAt: Timestamp.now()
    });
    await setDoc(doc(db, 'circles', circleId, 'members', 'owner'), memberData('owner', 'Owner', 'owner'));
    await setDoc(doc(db, 'circles', circleId, 'members', 'member'), memberData('member', 'Member'));
    await setDoc(doc(db, 'circles', circleId, 'members', 'target'), memberData('target', 'Target'));
    await setDoc(doc(db, 'users', 'member', 'circles', circleId), { name: 'Test circle', role: 'member' });
    await setDoc(doc(db, 'users', 'target', 'circles', circleId), { name: 'Test circle', role: 'member' });
    await setDoc(doc(db, 'invites', inviteCode), {
      circleId,
      createdBy: 'owner',
      createdAt: Timestamp.now(),
      expiresAt: future
    });
    await setDoc(doc(db, 'invites', 'EXPIRED123'), {
      circleId,
      createdBy: 'owner',
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() - 1000)
    });
    await setDoc(doc(db, 'circles', circleId, 'messages', 'message-one'), {
      uid: 'owner',
      displayName: 'Owner',
      text: 'A seeded message',
      createdAt: Timestamp.now()
    });
    await setDoc(doc(db, 'circles', circleId, 'plans', 'legacy-plan'), {
      title: 'Old poll',
      description: '',
      date: '2026-11-03',
      time: '18:00',
      place: 'Home',
      options: ['18:00', '19:00'],
      votes: ['member'],
      rsvps: ['member'],
      status: 'Voting open',
      createdBy: 'owner',
      createdAt: Timestamp.now()
    });
    await setDoc(doc(db, 'circles', circleId, 'quests', 'legacy-quest'), {
      uid: 'owner',
      createdAt: Timestamp.now(),
      title: 'Old quest',
      desc: '',
      icon: '✳'
    });
    await setDoc(doc(db, 'circles', circleId, 'memories', 'capsule-secret'), {
      uid: 'owner',
      createdAt: Timestamp.now(),
      type: 'time-capsule',
      icon: '⌛',
      title: 'Old capsule',
      desc: 'This should not be readable by members',
      date: '2026-11-03',
      by: 'Owner',
      color: 'link',
      unlockAt: '6 months'
    });
    await setDoc(doc(db, 'circles', circleId, 'memories', 'ordinary-memory'), {
      uid: 'owner',
      createdAt: Timestamp.now(),
      type: 'photo',
      icon: '▧',
      title: 'Ordinary memory',
      desc: '',
      date: '2026-11-03',
      by: 'Owner',
      color: 'photo'
    });
    await setDoc(doc(db, 'circles', circleId, 'commitments', 'commitment-one'), {
      uid: 'owner',
      createdAt: Timestamp.now(),
      text: 'Bring snacks',
      by: 'Owner',
      when: 'Tomorrow',
      done: false
    });
  });

  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  const memberDb = testEnv.authenticatedContext('member').firestore();
  const ownerDb = testEnv.authenticatedContext('owner').firestore();

  await allowed('members can read their own membership record', getDoc(doc(memberDb, 'circles', circleId, 'members', 'member')));
  await allowed('members can read the circle document', getDoc(doc(memberDb, 'circles', circleId)));

  await denied(
    'invite documents are not readable to signed-out visitors',
    getDoc(doc(anonymousDb, 'invites', inviteCode))
  );
  await allowed(
    'signed-in users can fetch a known invite code',
    getDoc(doc(memberDb, 'invites', inviteCode))
  );
  await allowed(
    'members can read existing messages at the circle messages path',
    getDoc(doc(memberDb, 'circles', circleId, 'messages', 'message-one'))
  );

  await allowed(
    'members can create messages with their own name and server timestamp',
    addDoc(collection(memberDb, 'circles', circleId, 'messages'), {
      uid: 'member',
      displayName: 'Member',
      text: 'A valid message',
      createdAt: serverTimestamp()
    })
  );
  await denied(
    'members cannot impersonate another display name',
    addDoc(collection(memberDb, 'circles', circleId, 'messages'), {
      uid: 'member',
      displayName: 'Owner',
      text: 'Spoof attempt',
      createdAt: serverTimestamp()
    })
  );
  await allowed(
    'members can send emoji-only messages',
    addDoc(collection(memberDb, 'circles', circleId, 'messages'), {
      uid: 'member',
      displayName: 'Member',
      text: '😂',
      createdAt: serverTimestamp()
    })
  );
  await allowed(
    'members can send replies with a replyTo message ID',
    addDoc(collection(memberDb, 'circles', circleId, 'messages'), {
      uid: 'member',
      displayName: 'Member',
      text: 'A reply',
      reply: 'Owner: A seeded message',
      replyTo: 'message-one',
      createdAt: serverTimestamp()
    })
  );
  await allowed(
    'members can send sticker attachments',
    addDoc(collection(memberDb, 'circles', circleId, 'messages'), {
      uid: 'member',
      displayName: 'Member',
      text: 'Sticker',
      attachmentDataUrl: 'data:image/webp;base64,AAAA',
      attachmentType: 'sticker',
      attachmentName: 'test sticker',
      createdAt: serverTimestamp()
    })
  );
  await denied(
    'members cannot forge message timestamps',
    addDoc(collection(memberDb, 'circles', circleId, 'messages'), {
      uid: 'member',
      displayName: 'Member',
      text: 'Forged timestamp',
      createdAt: Timestamp.fromMillis(1000)
    })
  );

  const messageRef = doc(memberDb, 'circles', circleId, 'messages', 'message-one');
  await allowed(
    'a member can add reactions under their own UID',
    updateDoc(messageRef, { reactionsByUser: { member: ['😂'] } })
  );
  await denied(
    'a member cannot add a reaction under somebody else’s UID',
    updateDoc(messageRef, { reactionsByUser: { member: ['😂'], owner: ['❤️'] } })
  );
  await denied(
    'a member cannot delete another member’s message',
    deleteDoc(messageRef)
  );

  const planRef = await (async () => {
    let ref;
    await allowed(
      'new plans can be created with map-based votes and RSVPs',
      (async () => {
        ref = await addDoc(collection(memberDb, 'circles', circleId, 'plans'), {
          title: 'New plan',
          description: '',
          date: '2026-11-07',
          time: '18:00',
          place: 'Home',
          options: ['18:00', '19:00'],
          votes: {},
          rsvps: {},
          status: 'Voting open',
          createdBy: 'member',
          createdAt: serverTimestamp()
        });
      })()
    );
    return ref;
  })();

  await allowed(
    'a member can update their own plan vote and RSVP keys',
    updateDoc(planRef, { votes: { member: 1 }, rsvps: { member: true } })
  );
  await denied(
    'a member cannot forge another person’s vote',
    updateDoc(planRef, { votes: { member: 1, owner: 0 }, rsvps: { member: true } })
  );
  await denied(
    'another member cannot change the plan creator’s title',
    updateDoc(doc(ownerDb, planRef.path), { title: 'Hijacked title' })
  );
  await denied(
    'legacy nested-array polls cannot be rewritten as maps by a member',
    updateDoc(doc(memberDb, 'circles', circleId, 'plans', 'legacy-plan'), {
      votes: { member: 0 },
      rsvps: { member: true }
    })
  );

  const legacyQuestRef = doc(memberDb, 'circles', circleId, 'quests', 'legacy-quest');
  await allowed(
    'legacy quests without doneBy can receive the first personal completion',
    updateDoc(legacyQuestRef, { doneBy: { member: true } })
  );
  await denied(
    'a member cannot mark a different member complete on a quest',
    updateDoc(legacyQuestRef, { doneBy: { member: true, owner: true } })
  );

  await allowed(
    'members can toggle a shared commitment without changing its text',
    updateDoc(doc(memberDb, 'circles', circleId, 'commitments', 'commitment-one'), {
      done: true,
      updatedAt: serverTimestamp()
    })
  );

  await denied(
    'members cannot read legacy Time Capsule documents',
    getDoc(doc(memberDb, 'circles', circleId, 'memories', 'capsule-secret'))
  );
  await allowed(
    'members can read ordinary memories',
    getDoc(doc(memberDb, 'circles', circleId, 'memories', 'ordinary-memory'))
  );
  await allowed(
    'the memory query excludes legacy Time Capsule documents',
    getDocs(query(
      collection(memberDb, 'circles', circleId, 'memories'),
      where('type', '!=', 'time-capsule')
    ))
  );

  const newcomerDb = testEnv.authenticatedContext('newcomer').firestore();
  await allowed(
    'a new member can join with a live invite without sharing email',
    setDoc(doc(newcomerDb, 'circles', circleId, 'members', 'newcomer'), {
      ...memberData('newcomer', 'Newcomer'),
      joinedAt: serverTimestamp(),
      inviteCode
    })
  );
  const emailLeakDb = testEnv.authenticatedContext('email-leak-test').firestore();
  await denied(
    'new member documents cannot include an email field',
    setDoc(doc(emailLeakDb, 'circles', circleId, 'members', 'email-leak-test'), {
      ...memberData('email-leak-test', 'Email test'),
      joinedAt: serverTimestamp(),
      inviteCode,
      email: 'private@example.com'
    })
  );
  const expiredDb = testEnv.authenticatedContext('expired-joiner').firestore();
  await denied(
    'expired invites cannot be used to join',
    setDoc(doc(expiredDb, 'circles', circleId, 'members', 'expired-joiner'), {
      ...memberData('expired-joiner', 'Expired joiner'),
      joinedAt: serverTimestamp(),
      inviteCode: 'EXPIRED123'
    })
  );

  await allowed(
    'the owner can remove a non-owner member and their circle index together',
    (async () => {
      const batch = writeBatch(ownerDb);
      batch.delete(doc(ownerDb, 'circles', circleId, 'members', 'target'));
      batch.delete(doc(ownerDb, 'users', 'target', 'circles', circleId));
      await batch.commit();
    })()
  );
  await denied(
    'the owner cannot delete their own membership and orphan the circle',
    deleteDoc(doc(ownerDb, 'circles', circleId, 'members', 'owner'))
  );
  await allowed(
    'a regular member can leave by deleting their own membership and index',
    (async () => {
      const batch = writeBatch(memberDb);
      batch.delete(doc(memberDb, 'circles', circleId, 'members', 'member'));
      batch.delete(doc(memberDb, 'users', 'member', 'circles', circleId));
      await batch.commit();
    })()
  );

  console.log(`\nFirestore rules checks passed: ${passed}`);
} finally {
  await testEnv.cleanup();
}
