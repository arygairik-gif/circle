import { GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, signOut, onAuthStateChanged, updateProfile } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, limit, where, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase.js';
const dayKey=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const safeText=(v,n=1000)=>String(v??'').trim().slice(0,n);
const validDisplayName=(value,email='')=>{
 const name=safeText(value,40),address=String(email||'').trim().toLowerCase(),local=address.split('@')[0]||'';
 if(!name||name.includes('@')||(local&&name.toLowerCase()===local))return '';
 return name;
};
const accountDisplayName=()=>validDisplayName(profileData.displayName,user?.email)||validDisplayName(user?.displayName,user?.email)||'Friend';
const ACTIVE_CIRCLE_KEY='circle.activeCircle.v1';
function getSavedCircleId(){try{return localStorage.getItem(ACTIVE_CIRCLE_KEY)||''}catch{return ''}}
function saveActiveCircleId(id){try{if(id)localStorage.setItem(ACTIVE_CIRCLE_KEY,String(id));else localStorage.removeItem(ACTIVE_CIRCLE_KEY)}catch{}}

const dailyPrompts=['Show us one tiny thing that made today better.','What is a song that fits your mood this week?','Share one photo-worthy corner near you.','What is something small you are looking forward to?','What snack would you bring to a group hangout?','What is one thing you learned recently?','Describe today using only three words.','What is a place you want to revisit with the circle?','Share a harmless unpopular opinion.','What is one memory that still makes you smile?'];
function dailyPrompt(){let n=0;for(const ch of dayKey())n=(n*31+ch.charCodeAt(0))>>>0;return dailyPrompts[n%dailyPrompts.length]}

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const gate=$('#cloudGate'), shell=$('.app');
let user=null,circleId=null,stops=[],firstMessageSnapshot=true,profileData={},signupPhotoDataUrl='';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const error=m=>{const el=$('#cloudError');if(el)el.textContent=m};
const explain=e=>({'auth/email-already-in-use':'That email already has an account. Sign in instead.','auth/invalid-credential':'Email or password is incorrect.','auth/weak-password':'Use at least 6 characters.','auth/unauthorized-domain':'Add this website in Firebase Authentication → Authorized domains.'}[e.code]||`Firebase error: ${e.code||e.message}`);
function stop(){stops.forEach(f=>f());stops=[]}
function gateView(html){gate.innerHTML=html;gate.hidden=false;shell.style.display='none'}
function showApp(){gate.hidden=true;shell.style.display=''}
async function prepareProfilePhoto(file){
 if(!file||!file.type.startsWith('image/'))throw new Error('Choose an image file.');
 if(file.size>8*1024*1024)throw new Error('Choose a photo smaller than 8 MB.');
 let bitmap;
 try{bitmap=await createImageBitmap(file)}catch{throw new Error('This image format could not be opened by your browser.')}
 const scale=Math.min(1,320/Math.max(bitmap.width,bitmap.height));
 let width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 if(!ctx){bitmap.close?.();throw new Error('Photo compression is unavailable in this browser.')}
 let blob=null;
 for(let attempt=0;attempt<8;attempt++){
  canvas.width=width;canvas.height=height;ctx.clearRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);
  blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',Math.max(.38,.78-attempt*.06)));
  if(blob&&blob.size<=140*1024)break;
  width=Math.max(1,Math.round(width*.88));height=Math.max(1,Math.round(height*.88));
 }
 bitmap.close?.();
 if(!blob||blob.size>140*1024)throw new Error('That photo could not be compressed enough. Try a smaller picture.');
 return readAsDataUrl(new File([blob],'circle-profile.jpg',{type:'image/jpeg'}));
}
function authShell(panel,mode='auth'){
 return `<div class="cloud-auth-layout ${mode==='setup'?'cloud-setup-layout':''}">
  <aside class="cloud-auth-story">
   <div class="cloud-story-brand"><span class="brand-mark">c</span><span><strong>circle</strong><small>CLOSER, TOGETHER</small></span></div>
   <div class="cloud-story-copy"><p class="cloud-kicker">A LITTLE SPACE FOR YOUR PEOPLE</p><h2>Good things<br>happen <em>together.</em></h2><p>Keep the chats, plans, tiny traditions and everyday moments with the people who matter.</p></div>
   <div class="cloud-story-scene" aria-hidden="true"><span class="cloud-scene-orbit orbit-one"></span><span class="cloud-scene-orbit orbit-two"></span><span class="cloud-scene-dot dot-one">M</span><span class="cloud-scene-dot dot-two">A</span><span class="cloud-scene-dot dot-three">R</span><span class="cloud-scene-note">the usuals · since always ✳</span></div>
   <div class="cloud-story-foot">PRIVATE CIRCLES · SMALL MOMENTS · REAL FRIENDSHIPS</div>
  </aside>
  <section class="cloud-panel">${panel}</section>
 </div>`;
}
function suggestedHandle(name,email=''){
 const base=safeText(name||email.split('@')[0]||'friend',24).toLowerCase().replace(/[^a-z0-9._]/g,'').replace(/^[._]+|[._]+$/g,'');
 return base.length>=3?base:'friend'+String(user?.uid||'').slice(0,5).toLowerCase();
}
function paintAuthAvatar(imageUrl,initial){
 const img=$('#cloudPhotoImg'),fallback=$('#cloudPhotoFallback');
 if(img){img.src=imageUrl||'';img.hidden=!imageUrl}
 if(fallback){fallback.textContent=(initial||'C').slice(0,1).toUpperCase();fallback.hidden=!!imageUrl}
}
function authScreen(){
 const panel=`<div class="cloud-mobile-brand"><span class="brand-mark">c</span><span>circle</span></div>
  <div class="cloud-panel-heading"><p class="cloud-kicker">CIRCLE · FRIENDS ONLY</p><h1>Closer, together.</h1><p class="cloud-copy">A private space for your chats, plans and favourite people.</p></div>
  <div class="cloud-auth-tabs"><span id="cloudModeLabel">Welcome back</span><span class="cloud-auth-secure">Private by design</span></div>
  <form id="cloudAuthForm" novalidate>
   <label>Email<input name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label>
   <label>Password<input name="password" type="password" autocomplete="current-password" required minlength="6" placeholder="At least 6 characters"></label>
   <div id="cloudIdentityWrap" class="cloud-identity-wrap" hidden>
    <div class="cloud-dp-row"><div class="cloud-dp-preview"><img id="cloudPhotoImg" alt="Profile photo preview" hidden><span id="cloudPhotoFallback">Y</span></div><div class="cloud-dp-copy"><strong>Your profile photo</strong><small>Pick a photo or use your initials for now.</small><label class="cloud-upload-btn" for="cloudSignupPhoto">Choose photo</label><input id="cloudSignupPhoto" class="cloud-file-input" type="file" accept="image/*"></div></div>
    <label>Display name<input name="displayName" maxlength="40" autocomplete="name" placeholder="What should friends call you?"></label>
    <label>Username<input name="handle" maxlength="24" autocomplete="username" required pattern="[A-Za-z0-9._]{3,24}" placeholder="e.g. gairik"></label>
    <p class="cloud-field-hint">3–24 characters · letters, numbers, dots or underscores.</p>
   </div>
   <div class="cloud-error" id="cloudError" role="alert"></div>
   <button class="cloud-primary" id="cloudSubmit">Sign in</button>
  </form>
  <div class="cloud-or"><span></span>OR<span></span></div>
  <button class="cloud-google" id="cloudGoogle"><span class="google-g">G</span> Continue with Google</button>
  <p class="cloud-switch"><span id="cloudSwitchText">New to Circle?</span> <button id="cloudSwitch" type="button">Create account</button></p>
  <p class="cloud-legal">By continuing, you agree to use Circle respectfully and keep your friends’ moments private.</p>`;
 gateView(authShell(panel));
 let mode='signin';
 const setMode=next=>{
  mode=next;const signup=mode==='signup';
  $('#cloudIdentityWrap').hidden=!signup;
  $('#cloudIdentityWrap').querySelector('[name="handle"]').required=signup;
  $('#cloudModeLabel').textContent=signup?'Make your space':'Welcome back';
  $('#cloudSubmit').textContent=signup?'Create account':'Sign in';
  $('#cloudSwitchText').textContent=signup?'Already have an account?':'New to Circle?';
  $('#cloudSwitch').textContent=signup?'Sign in':'Create account';
  error('');
  if(signup){paintAuthAvatar(signupPhotoDataUrl,$('#cloudAuthForm').elements.displayName.value||'Y')}
  else{signupPhotoDataUrl='';paintAuthAvatar('','Y')}
 };
 $('#cloudSwitch').onclick=()=>setMode(mode==='signin'?'signup':'signin');
 $('#cloudAuthForm').addEventListener('input',e=>{
  if(e.target.name==='displayName'&&!signupPhotoDataUrl)paintAuthAvatar('',e.target.value||'Y');
 });
 $('#cloudAuthForm').addEventListener('change',async e=>{
  if(e.target.id!=='cloudSignupPhoto')return;
  const file=e.target.files?.[0];if(!file)return;
  try{signupPhotoDataUrl=await prepareProfilePhoto(file);paintAuthAvatar(signupPhotoDataUrl,$('#cloudAuthForm').elements.displayName.value||'Y');error('')}
  catch(x){signupPhotoDataUrl='';paintAuthAvatar('',$('#cloudAuthForm').elements.displayName.value||'Y');error(x.message||'Could not prepare that photo.')}
 });
 $('#cloudAuthForm').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget,d=Object.fromEntries(new FormData(form)),b=$('#cloudSubmit');
  if(!form.reportValidity())return;
  b.disabled=true;
  try{
   if(mode==='signup'){
    const name=safeText(d.displayName,40),handle=safeText(d.handle,24).toLowerCase();
    if(!validDisplayName(name,d.email))throw new Error('Please enter the name you want friends to see.');
    if(!/^[a-z0-9._]{3,24}$/.test(handle))throw new Error('Choose a username with 3–24 letters, numbers, dots or underscores.');
    profileData={displayName:name,handle,bio:'',photoURL:signupPhotoDataUrl||'',email:d.email.trim()};
    const c=await createUserWithEmailAndPassword(auth,d.email.trim(),d.password);
    await updateProfile(c.user,{displayName:name});
    await setDoc(doc(db,'users',c.user.uid),{...profileData,createdAt:serverTimestamp()});
   }else await signInWithEmailAndPassword(auth,d.email.trim(),d.password);
  }catch(x){error(explain(x))}
  finally{b.disabled=false}
 };
 $('#cloudGoogle').onclick=async()=>{
  const b=$('#cloudGoogle');b.disabled=true;
  try{const result=await signInWithPopup(auth,new GoogleAuthProvider());const photo=result.user.photoURL||'';const current=await getDoc(doc(db,'users',result.user.uid));profileData={...(current.data()||{}),displayName:validDisplayName(current.data()?.displayName,result.user.email)||validDisplayName(result.user.displayName,result.user.email),handle:current.data()?.handle||'',bio:current.data()?.bio||'',photoURL:current.data()?.photoURL||photo,email:result.user.email};}
  catch(x){error(explain(x))}
  finally{b.disabled=false}
 };
}
function profileSetupScreen(){
 const googlePhoto=profileData.photoURL||user?.photoURL||'',displayName=validDisplayName(profileData.displayName,user?.email)||validDisplayName(user?.displayName,user?.email)||'';
 const defaultHandle=profileData.handle||suggestedHandle(displayName||'friend',user?.email||'');
 const photoMarkup=googlePhoto?`<img id="setupPhotoImg" src="${esc(googlePhoto)}" alt="Profile photo preview">`:`<span id="setupPhotoFallback">${esc(displayName.slice(0,1).toUpperCase())}</span>`;
 const panel=`<div class="cloud-mobile-brand"><span class="brand-mark">c</span><span>circle</span></div>
  <div class="cloud-panel-heading"><p class="cloud-kicker">ONE LAST LITTLE THING</p><h1>Make it yours.</h1><p class="cloud-copy">Your account is connected. Choose the name and username your friends will see, and check your profile photo before continuing.</p></div>
  <form id="cloudProfileSetupForm">
   <div class="cloud-setup-avatar-row"><div class="cloud-setup-avatar" id="setupAvatarPreview">${photoMarkup}</div><div><strong>Profile photo</strong><small>${googlePhoto?'Your current profile photo is ready. Keep it or choose another.':'Choose a photo so friends can recognise you.'}</small><label class="cloud-upload-btn" for="setupPhotoInput">Change photo</label><input id="setupPhotoInput" class="cloud-file-input" type="file" accept="image/*"></div></div>
   <label>Display name<input name="displayName" value="${esc(displayName)}" maxlength="40" required autocomplete="name"></label>
   <label>Username<input name="handle" value="${esc(defaultHandle)}" maxlength="24" required pattern="[A-Za-z0-9._]{3,24}" autocomplete="username" placeholder="e.g. gairik"></label>
   <label>Short bio <span class="cloud-optional">optional</span><input name="bio" value="${esc(profileData.bio||'')}" maxlength="160" placeholder="A little about you"></label>
   <p class="cloud-field-hint">Username: 3–24 characters, using letters, numbers, dots or underscores.</p>
   <div class="cloud-error" id="cloudError" role="alert"></div>
   <button class="cloud-primary" id="cloudSetupSubmit">Save and continue</button>
  </form>
  <button class="cloud-signout" id="cloudSetupSignout">Not you? Sign out</button>`;
 gateView(authShell(panel,'setup'));
 let selectedPhoto=googlePhoto;
 $('#cloudProfileSetupForm').addEventListener('input',e=>{
  if(e.target.name==='displayName'&&!selectedPhoto){const fallback=$('#setupPhotoFallback');if(fallback)fallback.textContent=(e.target.value||'C').slice(0,1).toUpperCase()}
 });
 $('#setupPhotoInput').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{selectedPhoto=await prepareProfilePhoto(file);$('#setupAvatarPreview').innerHTML=`<img id="setupPhotoImg" src="${esc(selectedPhoto)}" alt="Profile photo preview">`;const note=$('#setupAvatarPreview')?.parentElement?.querySelector('small');if(note)note.textContent='Your new photo is ready.';error('')}
  catch(x){error(x.message||'Could not prepare that photo.')}
 });
 $('#cloudProfileSetupForm').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;
  const d=Object.fromEntries(new FormData(form)),button=$('#cloudSetupSubmit');button.disabled=true;
  try{
   const handle=safeText(d.handle,24).toLowerCase();
   if(!/^[a-z0-9._]{3,24}$/.test(handle))throw new Error('Choose a username with 3–24 letters, numbers, dots or underscores.');
   const saved=await saveProfile({displayName:d.displayName,handle,bio:d.bio,photoURL:selectedPhoto});
   profileData={...profileData,...saved};
   picker(await myCircles());
  }catch(x){error(explain(x))}
  finally{button.disabled=false}
 };
 $('#cloudSetupSignout').onclick=()=>signOut(auth);
}

async function myCircles(){const s=await getDocs(collection(db,'users',user.uid,'circles'));return s.docs.map(d=>({id:d.id,...d.data()}))}
function picker(items){
 gateView(`<section class="cloud-panel cloud-wide"><div class="brand-mark">c</div><p class="cloud-kicker">YOUR PEOPLE, IN ONE PLACE</p><h1>Welcome, ${esc(accountDisplayName())}.</h1><p class="cloud-copy">Choose a circle or start a new one. Only invited members can see its conversations.</p>${items.length?`<div class="cloud-circle-list">${items.map(c=>`<button class="cloud-circle-choice" data-open-circle="${esc(c.id)}"><span class="cloud-circle-dot">✿</span><span><strong>${esc(c.name||'Your circle')}</strong><small>Open circle</small></span><b>→</b></button>`).join('')}</div>`:'<p class="cloud-empty">You haven’t joined a circle yet.</p>'}<div class="cloud-divider"><span>OR</span></div><form id="cloudCreateForm" class="cloud-inline"><label>Start a circle<input name="name" required maxlength="40" placeholder="e.g. The Usuals"></label><button class="cloud-primary">Create circle</button></form><form id="cloudJoinForm" class="cloud-inline"><label>Join with an invite code<input name="code" required maxlength="24" placeholder="Paste your invite code"></label><button class="cloud-secondary">Join circle</button></form><div class="cloud-error" id="cloudError" role="alert"></div><button class="cloud-signout" id="cloudSignOut">Sign out</button></section>`);
 $$('[data-open-circle]',gate).forEach(b=>b.onclick=()=>openCircle(b.dataset.openCircle));
 $('#cloudCreateForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const name=new FormData(e.currentTarget).get('name').trim(),code=makeCode(),r=await addDoc(collection(db,'circles'),{name,ownerUid:user.uid,inviteCode:code,createdAt:serverTimestamp()});await setDoc(doc(db,'circles',r.id,'members',user.uid),{uid:user.uid,name:accountDisplayName(),handle:profileData.handle||'',bio:profileData.bio||'',photoURL:profileData.photoURL||'',email:user.email,role:'owner',joinedAt:serverTimestamp()});await setDoc(doc(db,'users',user.uid,'circles',r.id),{name,role:'owner',joinedAt:serverTimestamp()});await setDoc(doc(db,'invites',code),{circleId:r.id,createdBy:user.uid,createdAt:serverTimestamp()});for(const q of [{title:'Share a tiny win',desc:'Tell the circle about one good thing from today.',icon:'✳'},{title:'Plan a low-key hangout',desc:'Suggest one simple thing to do together.',icon:'☕'},{title:'Send a throwback',desc:'Share a favourite moment from your group.',icon:'📷'}])await addDoc(collection(db,'circles',r.id,'quests'),{...q,uid:user.uid,done:false,people:1,createdAt:serverTimestamp()});await openCircle(r.id)}catch(x){error(explain(x))}finally{b.disabled=false}};
 $('#cloudJoinForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const code=String(new FormData(e.currentTarget).get('code')).trim().toUpperCase(),iv=await getDoc(doc(db,'invites',code));if(!iv.exists())throw new Error('Invite code not found. Ask a member for a current code.');const id=iv.data().circleId;await setDoc(doc(db,'circles',id,'members',user.uid),{uid:user.uid,name:accountDisplayName(),handle:profileData.handle||'',bio:profileData.bio||'',photoURL:profileData.photoURL||'',email:user.email,role:'member',inviteCode:code,joinedAt:serverTimestamp()});const c=await getDoc(doc(db,'circles',id));if(!c.exists())throw new Error('Circle not found.');await setDoc(doc(db,'users',user.uid,'circles',id),{name:c.data().name,role:'member',joinedAt:serverTimestamp()});await openCircle(id)}catch(x){error(x.message||explain(x))}finally{b.disabled=false}};
 $('#cloudSignOut').onclick=()=>signOut(auth);
}
function makeCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',a=crypto.getRandomValues(new Uint8Array(10));return [...a].map(x=>chars[x%chars.length]).join('')}
async function openCircle(id){
 stop();circleId=id;firstMessageSnapshot=true;
 const ui=window.CircleApp;let stage='checking circle membership';
 try{
  const m=await getDoc(doc(db,'circles',id,'members',user.uid));
  if(!m.exists())throw new Error('Your account is not listed as a member of this circle. Ask a current member for a new invite code.');
  stage='loading circle details';
  const c=await getDoc(doc(db,'circles',id));
  if(!c.exists())throw new Error('This circle no longer exists.');
  saveActiveCircleId(id);
  stage='opening circle interface';
  ui.state.circleName=c.data().name||'Your circle';ui.state.messages=[];ui.state.members=[];ui.state.plans=[];ui.state.commitments=[];ui.state.memories=[];ui.state.quests=[];ui.state.rituals=[];ui.state.drop={prompt:dailyPrompt(),posted:false,answer:'',entries:[]};ui.state.activities=[];ui.state.dropEntries=[];ui.state.quietReplies=[];ui.state.view='chat';ui.render();showApp();
  stops.push(onSnapshot(collection(db,'circles',id,'members'),s=>{
   const members=s.docs.map(d=>({id:d.id,...d.data(),status:d.data().status==='free'?'Free now':(d.data().status||'Around'),initial:(d.data().name||'?').slice(0,1).toUpperCase(),tone:'',photoURL:d.data().photoURL||'',handle:d.data().handle||'',bio:d.data().bio||''}));
   const mine=members.find(x=>x.id===user.uid);
   if(mine){ui.state.me.mood=mine.mood||null;ui.state.me.free=mine.status==='Free now';ui.state.me.activity=mine.activity||''}
   ui.state.members=members;ui.render();
  },e=>ui.toast('Members could not load: '+e.code)));
  stops.push(onSnapshot(query(collection(db,'circles',id,'messages'),orderBy('createdAt','desc'),limit(150)),s=>{
   if(firstMessageSnapshot){firstMessageSnapshot=false}
   else if(ui.state.settings?.browserNotifications&&'Notification' in window&&Notification.permission==='granted'&&document.visibilityState==='hidden'){
    s.docChanges().filter(change=>change.type==='added').forEach(change=>{const msg=change.doc.data();if(msg.uid!==user.uid)new Notification(`${msg.displayName||'Someone'} in ${ui.state.circleName||'Circle'}`,{body:(msg.text||'Shared an attachment').slice(0,140),tag:change.doc.id})});
   }
   ui.state.messages=[...s.docs].reverse().map(d=>{const x=d.data();return{id:d.id,from:x.uid===user.uid?'you':x.uid,time:x.createdAt?.toDate?.().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})||'now',text:x.text||'',image:x.attachmentType==='image'?x.attachmentDataUrl:'',audio:x.attachmentType==='audio'?x.attachmentDataUrl:'',reactions:Object.entries(x.reactions||{}).map(([k,v])=>`${k} ${v.length}`)}});
   ui.render();
  },e=>ui.toast('Messages could not load: '+e.code)));
  stops.push(onSnapshot(query(collection(db,'circles',id,'plans'),orderBy('createdAt','desc'),limit(50)),s=>{
   ui.state.plans=s.docs.map(d=>{const x=d.data();return{id:d.id,...x,options:x.options||[],votes:(x.votes||[]).map(a=>(a||[]).map(uid=>uid===user.uid?'you':uid)),rsvps:(x.rsvps||[]).map(uid=>uid===user.uid?'you':uid)}});
   ui.render();
  },e=>ui.toast('Plans could not load: '+e.code)));
  stage='loading your profile';
  const p=await getDoc(doc(db,'users',user.uid));profileData=p.data()||profileData||{};
  ui.state.me.displayName=accountDisplayName();ui.state.me.handle=profileData.handle||'';ui.state.me.bio=profileData.bio||'';ui.state.me.photoURL=profileData.photoURL||user.photoURL||'';ui.state.me.email=user.email||'';
  ui.render();
  // Profile changes are synced by saveProfile(). Opening a circle is read-only so stale
  // member metadata cannot block the entire circle from opening.
  const watch=(name,target,convert=d=>({id:d.id,...d.data()}))=>stops.push(onSnapshot(collection(db,'circles',id,name),s=>{ui.state[target]=s.docs.map(convert);ui.render()},e=>ui.toast(name+' could not load: '+e.code)));
  watch('commitments','commitments');watch('memories','memories');watch('rituals','rituals');watch('quests','quests');watch('activities','activities');
  async function listenDailyDropAnswers(targetCircleId){
   const ownRef=doc(db,'circles',targetCircleId,'dailyDrops',dayKey(),'answers',user.uid);
   const own=await getDoc(ownRef);
   ui.state.drop.posted=own.exists();ui.state.drop.answer=own.data()?.answer||'';
   if(own.exists())stops.push(onSnapshot(collection(db,'circles',targetCircleId,'dailyDrops',dayKey(),'answers'),s=>{
    ui.state.drop.entries=s.docs.map(d=>({id:d.id,...d.data()}));ui.render()
   },e=>ui.toast('Daily Drop answers could not load: '+e.code)));
   ui.render();
  }
  listenDailyDropAnswers(id).catch(e=>ui.toast('Daily Drop could not load: '+e.code));
  let sentReplies=[],receivedReplies=[];
  const renderReplies=()=>{ui.state.quietReplies=[...sentReplies,...receivedReplies].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i);ui.render()};
  stops.push(onSnapshot(query(collection(db,'circles',id,'privateReplies'),where('fromUid','==',user.uid)),s=>{sentReplies=s.docs.map(d=>({id:d.id,...d.data()}));renderReplies()},e=>ui.toast('Sent private replies could not load: '+e.code)));
  stops.push(onSnapshot(query(collection(db,'circles',id,'privateReplies'),where('toUid','==',user.uid)),s=>{receivedReplies=s.docs.map(d=>({id:d.id,...d.data()}));renderReplies()},e=>ui.toast('Received private replies could not load: '+e.code)));
  return true;
 }catch(x){
  stop();circleId=null;saveActiveCircleId('');
  const detail=x.code?x.code+': '+x.message:x.message||'Unknown error';
  gateView(`<section class="cloud-panel"><div class="brand-mark">c</div><p class="cloud-kicker">CIRCLE · CONNECTION CHECK</p><h1>Couldn’t open this circle</h1><p class="cloud-copy">${esc(detail)}</p><p class="cloud-field-hint">Where it stopped: ${esc(stage)}. Your circle data has not been deleted.</p><button class="cloud-primary" id="backCircles">Back to circles</button></section>`);
  $('#backCircles').onclick=()=>myCircles().then(picker).catch(e=>error(explain(e)));
  return false;
 }
}
async function enableBrowserNotifications(){
 if(!('Notification' in window))throw new Error('This browser does not support notifications.');
 const permission=await Notification.requestPermission();
 if(permission!=='granted')throw new Error('Notification permission was not granted.');
 window.CircleApp.state.settings.browserNotifications=true;
 window.CircleApp.render();
 return true;
}
async function sendMessage(text){const value=safeText(text,1500);if(!value)return;if(value.length>1500)throw new Error('Messages are limited to 1,500 characters.');await addDoc(collection(db,'circles',circleId,'messages'),{uid:user.uid,displayName:accountDisplayName(),text:value,createdAt:serverTimestamp(),reactions:{}})}
function readAsDataUrl(file){
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('Could not read that file.'));reader.readAsDataURL(file)});
}
async function compactImage(file){
 if(!file.type.startsWith('image/'))throw new Error('Choose an image file.');
 if(file.size>10*1024*1024)throw new Error('Choose an image smaller than 10 MB before compression.');
 let bitmap;
 try{bitmap=await createImageBitmap(file)}catch{throw new Error('This image format could not be opened by your browser.')}
 const scale=Math.min(1,720/Math.max(bitmap.width,bitmap.height));
 let width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 if(!ctx){bitmap.close?.();throw new Error('Image compression is unavailable in this browser.')}
 let blob=null;
 for(let attempt=0;attempt<7;attempt++){
  canvas.width=width;canvas.height=height;ctx.clearRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);
  blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',Math.max(.42,.78-attempt*.06)));
  if(blob&&blob.size<=300*1024)break;
  width=Math.max(1,Math.round(width*.88));height=Math.max(1,Math.round(height*.88));
 }
 bitmap.close?.();
 if(!blob||blob.size>300*1024)throw new Error('That image is still too large. Try a smaller or simpler picture.');
 return new File([blob],(safeText(file.name||'circle-photo',70).replace(/\.[^.]+$/,'')||'circle-photo')+'.jpg',{type:'image/jpeg'});
}
async function sendAttachment(file){
 if(!file)throw new Error('Choose a file first.');
 let prepared,type;
 if(file.type.startsWith('image/')){prepared=await compactImage(file);type='image'}
 else if(file.type.startsWith('audio/')){if(file.size>300*1024)throw new Error('Voice notes must be under 300 KB. Try a shorter recording.');prepared=file;type='audio'}
 else throw new Error('Only images and short audio recordings are supported.');
 const dataUrl=await readAsDataUrl(prepared);
 if(dataUrl.length>420000)throw new Error('This file is too large for the free Firestore attachment limit.');
 const name=safeText(prepared.name||'attachment',100);
 const messageRef=doc(collection(db,'circles',circleId,'messages'));
 const memoryRef=doc(collection(db,'circles',circleId,'memories'));
 const batch=writeBatch(db);
 batch.set(messageRef,{
  uid:user.uid,displayName:accountDisplayName(),
  text:type==='image'?'Shared a photo':'Shared a voice note',
  attachmentDataUrl:dataUrl,attachmentType:type,attachmentName:name,
  createdAt:serverTimestamp(),reactions:{}
 });
 batch.set(memoryRef,{uid:user.uid,type:type==='image'?'photo':'voice',icon:type==='image'?'▧':'♫',
  title:type==='image'?'A shared photo':'A voice note',desc:name,mediaUrl:dataUrl,mediaType:type,
  date:dayKey(),by:accountDisplayName(),color:type,createdAt:serverTimestamp()});
 await batch.commit();
 return {id:messageRef.id,type,name,size:prepared.size};
}
const addRecord=async(name,data)=>addDoc(collection(db,'circles',circleId,name),{...data,uid:user.uid,createdAt:serverTimestamp()});
async function addCommitment(d){return addRecord('commitments',{text:safeText(d.task,240),by:accountDisplayName(),when:safeText(d.when,80),done:false})}
async function toggleCommitment(id,done){return updateDoc(doc(db,'circles',circleId,'commitments',String(id)),{done:!!done,updatedAt:serverTimestamp()})}
async function addMemory(d){return addRecord('memories',{type:safeText(d.type,30),icon:safeText(d.icon,8),title:safeText(d.title,100),desc:safeText(d.desc,1200),date:dayKey(),by:accountDisplayName(),color:safeText(d.color,20),unlockAt:d.unlockAt||null})}
async function addRitual(d){return addRecord('rituals',{title:safeText(d.title,100),day:safeText(d.day,3),detail:safeText(d.detail,240)})}
async function addQuest(d){return addRecord('quests',{title:safeText(d.title,100),desc:safeText(d.desc,300),icon:safeText(d.icon,8),done:false,people:1})}
async function toggleQuest(id,done){return updateDoc(doc(db,'circles',circleId,'quests',String(id)),{done:!!done,updatedAt:serverTimestamp()})}
async function addActivity(d){return addRecord('activities',{type:safeText(d.type,40),answer:safeText(d.answer,1500),unlock:safeText(d.unlock,40),title:safeText(d.title,100)})}
async function addDropAnswer(answer,prompt){
 const value=safeText(answer,1000);if(!value)throw new Error('Write an answer first.');
 const answerRef=doc(db,'circles',circleId,'dailyDrops',dayKey(),'answers',user.uid);
 const existing=await getDoc(answerRef);if(existing.exists())throw new Error('You have already posted today.');
 await setDoc(answerRef,{uid:user.uid,date:dayKey(),prompt:safeText(prompt,300),answer:value,name:accountDisplayName(),createdAt:serverTimestamp()});
 const ui=window.CircleApp;ui.state.drop.posted=true;ui.state.drop.answer=value;
 stops.push(onSnapshot(collection(db,'circles',circleId,'dailyDrops',dayKey(),'answers'),s=>{
  ui.state.drop.entries=s.docs.map(d=>({id:d.id,...d.data()}));ui.render()
 },e=>ui.toast('Daily Drop answers could not load: '+e.code)));
 ui.render();
}
async function addQuietReply(toUid,messageId,reply){if(!toUid||toUid==='you'||toUid===user.uid)throw new Error('Choose another circle member.');return addRecord('privateReplies',{fromUid:user.uid,toUid,messageId:String(messageId),reply:safeText(reply,1500)})}
async function saveProfile(data){
 const displayName=validDisplayName(data.displayName,user?.email);
 if(!displayName)throw new Error('Add a display name that is not your email address.');
 const handle=safeText(data.handle,24).replace(/[^a-zA-Z0-9._]/g,'');
 const bio=safeText(data.bio,160);
 const photoURL=typeof data.photoURL==='string'?data.photoURL:(profileData.photoURL||'');
 if(photoURL.length>220000)throw new Error('That profile photo is too large. Choose another image.');
 await setDoc(doc(db,'users',user.uid),{displayName,handle,bio,photoURL,email:user.email,updatedAt:serverTimestamp()},{merge:true});
 await updateProfile(user,{displayName});
 const circles=await getDocs(collection(db,'users',user.uid,'circles'));
 await Promise.all(circles.docs.map(async c=>{
  const ref=doc(db,'circles',c.id,'members',user.uid),member=await getDoc(ref);
  if(member.exists())await updateDoc(ref,{name:displayName,handle,bio,photoURL});
 }));
 profileData={...profileData,displayName,handle,bio,photoURL};
 return profileData;
}
async function setSupport(enabled,preference=''){return updateDoc(memberRef(),{support:!!enabled,supportPreference:safeText(preference,100),lastSeen:serverTimestamp()})}
async function createPlan(d){const options=String(d.options||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,8);await addDoc(collection(db,'circles',circleId,'plans'),{title:String(d.title).slice(0,100),description:String(d.description||'').slice(0,500),date:d.date||'',time:options[0]||'',place:String(d.place||'').slice(0,120),options,votes:options.map(()=>[]),rsvps:[],status:'Voting open',createdBy:user.uid,createdAt:serverTimestamp()})}
async function react(id,emoji){const r=doc(db,'circles',circleId,'messages',String(id));await runTransaction(db,async tx=>{const s=await tx.get(r);if(!s.exists())return;const all={...(s.data().reactions||{})},a=Array.isArray(all[emoji])?[...all[emoji]]:[],i=a.indexOf(user.uid);if(i>=0)a.splice(i,1);else a.push(user.uid);all[emoji]=a;tx.update(r,{reactions:all})})}
async function votePlan(id,n){const r=doc(db,'circles',circleId,'plans',String(id));await runTransaction(db,async tx=>{const s=await tx.get(r);if(!s.exists())throw new Error('Plan no longer exists.');const d=s.data(),v=(d.votes||[]).map(a=>[...(a||[])]);while(v.length<(d.options||[]).length)v.push([]);v.forEach(a=>{const i=a.indexOf(user.uid);if(i>=0)a.splice(i,1)});if(!v[n])throw new Error('Option unavailable.');v[n].push(user.uid);const rs=[...(d.rsvps||[])];if(!rs.includes(user.uid))rs.push(user.uid);tx.update(r,{votes:v,rsvps:rs})})}
async function rsvpPlan(id){const r=doc(db,'circles',circleId,'plans',String(id));await runTransaction(db,async tx=>{const s=await tx.get(r);if(!s.exists())throw new Error('Plan no longer exists.');const rs=[...(s.data().rsvps||[])],i=rs.indexOf(user.uid);if(i>=0)rs.splice(i,1);else rs.push(user.uid);tx.update(r,{rsvps:rs})})}
const memberRef=()=>doc(db,'circles',circleId,'members',user.uid);
async function setMood(mood){await updateDoc(memberRef(),{mood:String(mood).slice(0,8),lastSeen:serverTimestamp()})}
async function setAvailability(free,activity=''){await updateDoc(memberRef(),{status:free?'free':'around',activity:String(activity).slice(0,80),lastSeen:serverTimestamp()})}
window.CircleCloud={saveProfile,prepareProfilePhoto,backToCircles:async()=>{stop();circleId=null;saveActiveCircleId('');picker(await myCircles())},get circleId(){return circleId},get user(){return user},sendMessage,sendAttachment,createPlan,react,votePlan,rsvpPlan,setMood,setAvailability,addCommitment,toggleCommitment,addMemory,addRitual,addQuest,toggleQuest,addActivity,addDropAnswer,addQuietReply,setSupport,enableBrowserNotifications,signOut:()=>{saveActiveCircleId('');return signOut(auth)},inviteCode:async()=>{const s=await getDoc(doc(db,'circles',circleId));return s.data()?.inviteCode||''}};
onAuthStateChanged(auth,async u=>{
 stop();user=u;
 if(!u){profileData={};authScreen();return}
 try{
  const r=doc(db,'users',u.uid),p=await getDoc(r),saved=p.data()||{};
  const savedName=validDisplayName(saved.displayName,u.email),authName=validDisplayName(u.displayName,u.email);
  profileData={...profileData,...saved,displayName:savedName||authName,email:u.email,photoURL:saved.photoURL||profileData.photoURL||u.photoURL||'',handle:saved.handle||profileData.handle||'',bio:saved.bio||profileData.bio||''};
  await setDoc(r,{displayName:profileData.displayName||'',email:u.email,photoURL:profileData.photoURL,handle:profileData.handle,bio:profileData.bio},{merge:true});
  if(!profileData.handle||!profileData.displayName){saveActiveCircleId('');profileSetupScreen();return}
  const circles=await myCircles(),savedCircleId=getSavedCircleId(),savedCircle=circles.find(item=>item.id===savedCircleId);
  if(savedCircle){const opened=await openCircle(savedCircle.id);if(opened)return;return}
  if(savedCircleId&&!savedCircle)saveActiveCircleId('');
  picker(circles);
 }catch(x){authScreen();error(`Firebase setup issue: ${x.code||x.message}. Enable Authentication and create a Firestore database.`)}
});
