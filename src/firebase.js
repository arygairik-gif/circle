import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAwTHBN8jkgKR8oOngKh_UEJP6Oku67qr8',
  authDomain: 'circle-20c34.firebaseapp.com',
  projectId: 'circle-20c34',
  messagingSenderId: '951127942121',
  appId: '1:951127942121:web:7b4b07a157f06e1329a178',
  measurementId: 'G-CPS9N0GHQD'
};

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
