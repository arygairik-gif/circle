import { GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, signOut, onAuthStateChanged, updateProfile } from 'firebase/auth';
import { addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, limit, where, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase.js';
const dayKey=()=>new Date().toISOString().slice(0,10);
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
async function persistActiveCircleId(id){
 saveActiveCircleId(id);
 if(!user?.uid||!id)return;
 try{await setDoc(doc(db,'users',user.uid),{activeCircleId:String(id),activeCircleUpdatedAt:serverTimestamp()},{merge:true})}
 catch(e){console.warn('Could not sync the active circle preference:',e?.code||e?.message)}
}

const dailyPrompts=['Show us one tiny thing that made today better.','What is a song that fits your mood this week?','Share one photo-worthy corner near you.','What is something small you are looking forward to?','What snack would you bring to a group hangout?','What is one thing you learned recently?','Describe today using only three words.','What is a place you want to revisit with the circle?','Share a harmless unpopular opinion.','What is one memory that still makes you smile?'];
function dailyPrompt(){let n=0;for(const ch of dayKey())n=(n*31+ch.charCodeAt(0))>>>0;return dailyPrompts[n%dailyPrompts.length]}
function isQuietNow(settings={}){
 if(!settings.quiet)return false;
 const minutes=value=>{const parts=String(value||'').split(':').map(Number);return parts.length===2&&parts.every(Number.isFinite)?parts[0]*60+parts[1]:NaN};
 const start=minutes(settings.quietStart),end=minutes(settings.quietEnd),now=new Date(),current=now.getHours()*60+now.getMinutes();
 if(!Number.isFinite(start)||!Number.isFinite(end)||start===end)return false;
 return start<end?current>=start&&current<end:current>=start||current<end;
}

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const gate=$('#cloudGate'), shell=$('.app');
let user=null,circleId=null,stops=[],firstMessageSnapshot=true,profileData={},signupPhotoDataUrl='',dailyDropTimer=null,dropAnswerStop=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const error=m=>{const el=$('#cloudError');if(el)el.textContent=m};
const explain=e=>({'auth/email-already-in-use':'That email already has an account. Sign in instead.','auth/invalid-credential':'Email or password is incorrect.','auth/weak-password':'Use at least 6 characters.','auth/unauthorized-domain':'Add this website in Firebase Authentication → Authorized domains.'}[e.code]||`Firebase error: ${e.code||e.message}`);
function stop(){if(dailyDropTimer){clearInterval(dailyDropTimer);dailyDropTimer=null}if(dropAnswerStop){dropAnswerStop();dropAnswerStop=null}stops.forEach(f=>f());stops=[]}
function gateView(html){gate.innerHTML=html;gate.hidden=false;gate.setAttribute('aria-busy','false');shell.style.display='none'}
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
  <div class="cloud-panel-heading"><p class="cloud-kicker">CIRCLE · FRIENDS ONLY</p><h1>Closer, together.</h1><p class="cloud-copy">A private space for your chats, plans and favourite people.</p><p class="cloud-feature-line">Private group chats · shared plans · moments worth keeping</p></div>
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
  <p class="cloud-switch"><span id="cloudSwitchText">New to Circle?</span> <button id="cloudSwitch" type="button">Get started</button></p>
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
  $('#cloudSwitch').textContent=signup?'Back to sign in':'Get started';
  error('');
  if(signup){paintAuthAvatar(signupPhotoDataUrl,$('#cloudAuthForm').elements.displayName.value||'Y')}
  else{signupPhotoDataUrl='';paintAuthAvatar('','Y')}
 };
 setMode('signin');
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
 gateView(`<section class="cloud-panel cloud-wide"><div class="brand-mark">c</div><p class="cloud-kicker">YOUR PEOPLE, IN ONE PLACE</p><h1>Welcome, ${esc(accountDisplayName())}.</h1><p class="cloud-copy">Choose a circle or start a new one. Only invited members can see its conversations.</p>${items.length?`<div class="cloud-circle-list">${items.map(c=>`<button class="cloud-circle-choice" data-open-circle="${esc(c.id)}"><span class="cloud-circle-dot">✿</span><span><strong>${esc(c.name||'Untitled circle')}</strong><small>Open circle</small></span><b>→</b></button>`).join('')}</div>`:'<div class="cloud-empty"><strong>You’re not in a circle yet.</strong><span>Create one for your group, or join a friend using their invite code below.</span></div>'}<div class="cloud-divider"><span>OR</span></div><form id="cloudCreateForm" class="cloud-inline"><label>Start a circle<input name="name" required maxlength="40" placeholder="e.g. The Usuals"></label><button class="cloud-primary">Create circle</button></form><form id="cloudJoinForm" class="cloud-inline"><label>Join with an invite code<input name="code" required maxlength="24" placeholder="Paste your invite code"></label><button class="cloud-secondary">Join circle</button></form><div class="cloud-error" id="cloudError" role="alert"></div><button class="cloud-signout" id="cloudSignOut">Sign out</button></section>`);
 $$('[data-open-circle]',gate).forEach(b=>b.onclick=()=>openCircle(b.dataset.openCircle));
 $('#cloudCreateForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const name=safeText(new FormData(e.currentTarget).get('name'),40);if(!name)throw new Error('Give your circle a name.');const code=makeCode(),circleRef=doc(collection(db,'circles')),batch=writeBatch(db),memberRef=doc(db,'circles',circleRef.id,'members',user.uid),indexRef=doc(db,'users',user.uid,'circles',circleRef.id);batch.set(circleRef,{name,ownerUid:user.uid,inviteCode:code,createdAt:serverTimestamp()});batch.set(memberRef,{uid:user.uid,name:accountDisplayName(),handle:profileData.handle||'',bio:profileData.bio||'',photoURL:profileData.photoURL||'',role:'owner',status:'around',joinedAt:serverTimestamp()});batch.set(indexRef,{name,role:'owner',joinedAt:serverTimestamp()});batch.set(doc(db,'invites',code),{circleId:circleRef.id,circleName:name,createdBy:user.uid,createdAt:serverTimestamp(),expiresAt:new Date(Date.now()+7*24*60*60*1000)});for(const q of [{title:'Share a tiny win',desc:'Tell the circle about one good thing from today.',icon:'✳'},{title:'Plan a low-key hangout',desc:'Suggest one simple thing to do together.',icon:'☕'},{title:'Send a throwback',desc:'Share a favourite moment from your group.',icon:'📷'}])batch.set(doc(collection(db,'circles',circleRef.id,'quests')),{...q,uid:user.uid,doneBy:{},createdAt:serverTimestamp()});await batch.commit();await openCircle(circleRef.id)}catch(x){error(explain(x))}finally{b.disabled=false}};
 $('#cloudJoinForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const code=String(new FormData(e.currentTarget).get('code')).trim().toUpperCase();if(!code)throw new Error('Enter an invite code.');let circleRefId='';await runTransaction(db,async tx=>{const inviteRef=doc(db,'invites',code),inviteSnap=await tx.get(inviteRef);if(!inviteSnap.exists())throw new Error('Invite code not found. Ask a member for a current code.');const invite=inviteSnap.data();if(invite.revokedAt||(invite.expiresAt&&invite.expiresAt.toMillis()<=Date.now()))throw new Error('That invite has expired or been revoked. Ask for a new code.');circleRefId=invite.circleId;const circleRef=doc(db,'circles',circleRefId),memberRef=doc(db,'circles',circleRefId,'members',user.uid),indexRef=doc(db,'users',user.uid,'circles',circleRefId);const memberSnap=await tx.get(memberRef),indexSnap=await tx.get(indexRef);if(!memberSnap.exists())tx.set(memberRef,{uid:user.uid,name:accountDisplayName(),handle:profileData.handle||'',bio:profileData.bio||'',photoURL:profileData.photoURL||'',role:'member',status:'around',inviteCode:code,joinedAt:serverTimestamp()});if(!indexSnap.exists())tx.set(indexRef,{name:safeText(invite.circleName,40)||'Untitled circle',role:'member',joinedAt:serverTimestamp()})});await openCircle(circleRefId)}catch(x){error(x.message||explain(x))}finally{b.disabled=false}};
 $('#cloudSignOut').onclick=()=>signOut(auth);
}
function makeCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',a=crypto.getRandomValues(new Uint8Array(10));return [...a].map(x=>chars[x%chars.length]).join('')}
async function backToPickerAfterAccessLoss(){stop();circleId=null;saveActiveCircleId('');try{picker(await myCircles())}catch(e){authScreen();error('Could not reload your circles: '+(e.code||e.message))}}
async function openCircle(id){
 stop();circleId=id;firstMessageSnapshot=true;
 const ui=window.CircleApp;let stage='checking circle membership';
 try{
  const memberDocument=doc(db,'circles',id,'members',user.uid),m=await getDoc(memberDocument);
  if(!m.exists())throw new Error('Your account is not listed as a member of this circle. Ask a current member for a new invite code.');
  if('email' in m.data())await updateDoc(memberDocument,{email:deleteField()}).catch(e=>console.warn('Could not remove legacy member email field:',e?.code||e?.message));
  stage='loading circle details';
  const c=await getDoc(doc(db,'circles',id));
  if(!c.exists())throw new Error('This circle no longer exists.');
  const isCircleOwner=c.data().ownerUid===user.uid;
  await persistActiveCircleId(id);
  stage='opening circle interface';
  ui.state.circleName=c.data().name||'Untitled circle';ui.state.messages=[];ui.state.stickers=[];ui.state.members=[];ui.state.membersLoaded=false;ui.state.membersError=false;ui.state.me.displayName=accountDisplayName();ui.state.me.name=accountDisplayName();ui.state.me.handle=profileData.handle||'';ui.state.me.bio=profileData.bio||'';ui.state.me.photoURL=profileData.photoURL||user.photoURL||'';ui.state.plans=[];ui.state.commitments=[];ui.state.memories=[];ui.state.quests=[];ui.state.rituals=[];ui.state.drop={prompt:dailyPrompt(),dayKey:dayKey(),posted:false,answer:'',entries:[]};ui.state.activities=[];ui.state.tracks=[];ui.state.dropEntries=[];ui.state.quietReplies=[];ui.state.view='chat';ui.render();showApp();
  stops.push(onSnapshot(collection(db,'circles',id,'members'),s=>{
   if(isCircleOwner){
    s.docs.filter(d=>Object.prototype.hasOwnProperty.call(d.data(),'email')).forEach(d=>{
     updateDoc(d.ref,{email:deleteField()}).catch(e=>console.warn('Legacy member email cleanup failed:',e?.code||e?.message));
    });
   }
   const members=s.docs.map(d=>{const data=d.data(),until=data.freeUntil?.toDate?.()||null,isFree=data.status==='free'&&until&&until.getTime()>Date.now();return{id:d.id,...data,status:isFree?'Free now':'Around',initial:(data.name||'?').slice(0,1).toUpperCase(),tone:'',photoURL:data.photoURL||'',handle:data.handle||'',bio:data.bio||''}});
   const mine=members.find(x=>x.id===user.uid);
   if(!mine){backToPickerAfterAccessLoss();return}
   ui.state.me.mood=mine.mood||null;ui.state.me.free=mine.status==='Free now';ui.state.me.activity=mine.activity||'';
   ui.state.members=members;ui.state.membersLoaded=true;ui.state.membersError=false;ui.render();
  },e=>{if(e.code==='permission-denied'){backToPickerAfterAccessLoss();return}ui.state.membersLoaded=true;ui.state.membersError=true;ui.render();ui.toast('Members could not load: '+e.code)}));
  stops.push(onSnapshot(collection(db,'users',user.uid,'stickers'),s=>{
   ui.state.stickers=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
   if(ui.state.view==='stickers')ui.render();
  },e=>ui.toast('Your stickers could not load: '+e.code)));
  stops.push(onSnapshot(query(collection(db,'circles',id,'messages'),orderBy('createdAt','desc'),limit(150)),s=>{
   if(firstMessageSnapshot){firstMessageSnapshot=false}
   else if(ui.state.settings?.browserNotifications&&!isQuietNow(ui.state.settings)&&'Notification' in window&&Notification.permission==='granted'&&document.visibilityState==='hidden'){
    s.docChanges().filter(change=>change.type==='added').forEach(change=>{const msg=change.doc.data();if(msg.uid!==user.uid)new Notification(`${msg.displayName||'Someone'} in ${ui.state.circleName||'Circle'}`,{body:(msg.text||'Shared an attachment').slice(0,140),tag:change.doc.id})});
   }
   ui.state.messages=[...s.docs].reverse().map(d=>{const x=d.data();return{id:d.id,from:x.uid===user.uid?'you':x.uid,senderName:x.displayName||'Member',day:x.createdAt?.toDate?.().toISOString().slice(0,10)||'',time:x.createdAt?.toDate?.().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})||'now',text:x.text||'',reply:x.reply||'',replyTo:x.replyTo||'',image:x.attachmentType==='image'?x.attachmentDataUrl:'',sticker:x.attachmentType==='sticker'?x.attachmentDataUrl:'',audio:x.attachmentType==='audio'?x.attachmentDataUrl:'',reactions:x.reactions||{},reactionsByUser:x.reactionsByUser||{}}});
   ui.render();
  },e=>ui.toast('Messages could not load: '+e.code)));
  stops.push(onSnapshot(query(collection(db,'circles',id,'plans'),orderBy('createdAt','desc'),limit(50)),s=>{
   ui.state.plans=s.docs.map(d=>{const x=d.data(),legacyVoteData=Array.isArray(x.votes)||Array.isArray(x.rsvps),voteMap=x.votes&&typeof x.votes==='object'&&!Array.isArray(x.votes)?x.votes:{},rsvpMap=x.rsvps&&typeof x.rsvps==='object'&&!Array.isArray(x.rsvps)?x.rsvps:{};return{id:d.id,...x,legacyVoteData,options:Array.isArray(x.options)?x.options:[],votes:Array.isArray(x.votes)?x.votes.map(a=>Array.isArray(a)?a.map(uid=>uid===user.uid?'you':uid):[]):(Array.isArray(x.options)?x.options:[]).map((_,i)=>Object.keys(voteMap).filter(uid=>voteMap[uid]===i).map(uid=>uid===user.uid?'you':uid)),rsvps:Array.isArray(x.rsvps)?x.rsvps.map(uid=>uid===user.uid?'you':uid):Object.keys(rsvpMap).filter(uid=>rsvpMap[uid]===true).map(uid=>uid===user.uid?'you':uid)}});
   ui.render();
  },e=>ui.toast('Plans could not load: '+e.code)));
  stage='loading your profile';
  const p=await getDoc(doc(db,'users',user.uid));profileData=p.data()||profileData||{};
  ui.state.me.displayName=accountDisplayName();ui.state.me.handle=profileData.handle||'';ui.state.me.bio=profileData.bio||'';ui.state.me.photoURL=profileData.photoURL||user.photoURL||'';ui.state.me.email=user.email||'';
  ui.render();
  // Profile changes are synced by saveProfile(). Opening a circle is read-only so stale
  // member metadata cannot block the entire circle from opening.
  const watch=(name,target,convert=d=>({id:d.id,...d.data()}))=>stops.push(onSnapshot(collection(db,'circles',id,name),s=>{ui.state[target]=s.docs.map(convert);ui.render()},e=>ui.toast(name+' could not load: '+e.code)));
  watch('commitments','commitments');stops.push(onSnapshot(query(collection(db,'circles',id,'memories'),where('type','!=','time-capsule')),snap=>{ui.state.memories=snap.docs.map(d=>({id:d.id,...d.data()}));ui.render()},e=>ui.toast('Memories could not load: '+e.code)));watch('rituals','rituals');watch('quests','quests',d=>{const x=d.data();return{id:d.id,...x,done:!!x.doneBy?.[user.uid]}});watch('activities','activities');watch('tracks','tracks');
  async function listenDailyDropAnswers(targetCircleId,targetDay=dayKey()){
   if(dropAnswerStop){dropAnswerStop();dropAnswerStop=null}
   const ownRef=doc(db,'circles',targetCircleId,'dailyDrops',targetDay,'answers',user.uid);
   const own=await getDoc(ownRef);
   if(ui.state.drop.dayKey!==targetDay)return;
   ui.state.drop.posted=own.exists();ui.state.drop.answer=own.data()?.answer||'';ui.state.drop.photoDataUrl=own.data()?.photoDataUrl||'';
   if(own.exists())dropAnswerStop=onSnapshot(collection(db,'circles',targetCircleId,'dailyDrops',targetDay,'answers'),snap=>{
    if(ui.state.drop.dayKey!==targetDay)return;
    ui.state.drop.entries=snap.docs.map(d=>({id:d.id,...d.data()}));ui.render()
   },e=>ui.toast('Daily Drop answers could not load: '+e.code));
   ui.render();
  }
  listenDailyDropAnswers(id).catch(e=>ui.toast('Daily Drop could not load: '+e.code));
  dailyDropTimer=setInterval(()=>{
   const currentDay=dayKey();
   if(ui.state.drop.dayKey===currentDay)return;
   ui.state.drop={prompt:dailyPrompt(),dayKey:currentDay,posted:false,answer:'',photoDataUrl:'',entries:[]};
   ui.render();
   listenDailyDropAnswers(id,currentDay).catch(e=>ui.toast('Daily Drop could not refresh: '+e.code));
  },30000);
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
 window.CircleApp.save?.();
 window.CircleApp.render();
 return true;
}
async function sendMessage(text,reply='',replyToId=''){
 const value=safeText(text,1500);if(!value)return false;
 if(value.length>1500)throw new Error('Messages are limited to 1,500 characters.');
 const payload={uid:user.uid,displayName:accountDisplayName(),text:value,createdAt:serverTimestamp()};
 const quoted=safeText(reply,320),parentId=safeText(replyToId,128);if(quoted)payload.reply=quoted;if(parentId)payload.replyTo=parentId;
 await addDoc(collection(db,'circles',circleId,'messages'),payload);
 return true;
}
function readAsDataUrl(file){
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('Could not read that file.'));reader.readAsDataURL(file)});
}
async function compactImage(file,maxBytes=240*1024){
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
  if(blob&&blob.size<=maxBytes)break;
  width=Math.max(1,Math.round(width*.88));height=Math.max(1,Math.round(height*.88));
 }
 bitmap.close?.();
 if(!blob||blob.size>maxBytes)throw new Error('That image is still too large. Try a smaller or simpler picture.');
 return new File([blob],(safeText(file.name||'circle-photo',70).replace(/\.[^.]+$/,'')||'circle-photo')+'.jpg',{type:'image/jpeg'});
}
async function sendAttachment(file){
 if(!file)throw new Error('Choose a file first.');
 let prepared,type;
 if(file.type.startsWith('image/')){prepared=await compactImage(file,240*1024);type='image'}
 else if(file.type.startsWith('audio/')){if(file.size>300*1024)throw new Error('Voice notes must be under 300 KB. Try a shorter recording.');prepared=file;type='audio'}
 else throw new Error('Only images and short audio recordings are supported.');
 const dataUrl=await readAsDataUrl(prepared);
 const maxDataUrl=type==='image'?360000:420000;
 if(dataUrl.length>maxDataUrl)throw new Error('This file is too large for the free Firestore attachment limit. Try a smaller photo or shorter audio clip.');
 const name=safeText(prepared.name||'attachment',100);
 const messageRef=await addDoc(collection(db,'circles',circleId,'messages'),{
  uid:user.uid,displayName:accountDisplayName(),
  text:type==='image'?'Shared a photo':'Shared a voice note',
  attachmentDataUrl:dataUrl,attachmentType:type,attachmentName:name,
  createdAt:serverTimestamp()
 });
 let memorySaved=true;
 try{
  await addDoc(collection(db,'circles',circleId,'memories'),{
   uid:user.uid,type:type==='image'?'photo':'voice',icon:type==='image'?'▧':'♫',
   title:type==='image'?'A shared photo':'A voice note',desc:name,mediaUrl:dataUrl,mediaType:type,
   date:dayKey(),by:accountDisplayName(),color:type,createdAt:serverTimestamp()
  });
 }catch(memoryError){
  memorySaved=false;
  console.warn('Circle message sent, but Memory Vault copy was denied:',memoryError?.code||memoryError?.message);
 }
 return {id:messageRef.id,type,name,size:prepared.size,memorySaved};
}
async function prepareDailyDropPhoto(file){
 const prepared=await compactImage(file,140*1024);
 const dataUrl=await readAsDataUrl(prepared);
 if(dataUrl.length>200000)throw new Error('Choose a smaller photo for Today’s Drop.');
 return dataUrl;
}

async function prepareSticker(file){
 if(!file||!file.type.startsWith('image/'))throw new Error('Choose a PNG, JPG or WebP image.');
 if(file.size>10*1024*1024)throw new Error('Choose an image smaller than 10 MB.');
 let bitmap;
 try{bitmap=await createImageBitmap(file)}catch{throw new Error('This image format could not be opened by your browser.')}
 let width=Math.max(1,Math.round(bitmap.width*Math.min(1,512/Math.max(bitmap.width,bitmap.height))));
 let height=Math.max(1,Math.round(bitmap.height*Math.min(1,512/Math.max(bitmap.width,bitmap.height))));
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 if(!ctx){bitmap.close?.();throw new Error('Sticker compression is unavailable in this browser.')}
 let blob=null;
 for(let attempt=0;attempt<8;attempt++){
  canvas.width=width;canvas.height=height;ctx.clearRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);
  blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',Math.max(.48,.88-attempt*.05)));
  if(blob&&blob.size<=128*1024)break;
  width=Math.max(1,Math.round(width*.88));height=Math.max(1,Math.round(height*.88));
 }
 bitmap.close?.();
 if(!blob||blob.size>128*1024)throw new Error('That sticker is still too large. Try a simpler or smaller image.');
 return readAsDataUrl(new File([blob],'circle-sticker.webp',{type:blob.type||'image/webp'}));
}
async function saveSticker(name,dataUrl){
 const label=safeText(name,40)||'My sticker';
 if(typeof dataUrl!=='string'||!dataUrl.startsWith('data:image/')||dataUrl.length>180000)throw new Error('Choose a valid sticker image under the size limit.');
 const existing=await getDocs(query(collection(db,'users',user.uid,'stickers'),limit(40)));
 if(existing.size>=40)throw new Error('Your shelf is full. Remove a sticker before adding another.');
 const ref=await addDoc(collection(db,'users',user.uid,'stickers'),{uid:user.uid,name:label,dataUrl,createdAt:serverTimestamp()});
 return {id:ref.id,name:label,dataUrl};
}
async function deleteSticker(id){
 await deleteDoc(doc(db,'users',user.uid,'stickers',String(id)));
}
async function sendSticker(id){
 const snap=await getDoc(doc(db,'users',user.uid,'stickers',String(id)));
 if(!snap.exists())throw new Error('That sticker is no longer in your shelf.');
 const sticker=snap.data();
 await addDoc(collection(db,'circles',circleId,'messages'),{
  uid:user.uid,displayName:accountDisplayName(),text:'Sticker',
  attachmentDataUrl:sticker.dataUrl,attachmentType:'sticker',attachmentName:safeText(sticker.name,40),
  createdAt:serverTimestamp()
 });
}
async function addDropAnswer(answer,prompt,photoDataUrl=''){
 const value=safeText(answer,1000),photo=typeof photoDataUrl==='string'?photoDataUrl:'';
 if(!value&&!photo)throw new Error('Write an answer or add a photo first.');
 if(photo&&(!photo.startsWith('data:image/')||photo.length>200000))throw new Error('That Daily Drop photo is not valid or is too large.');
 const targetDay=dayKey(),answerRef=doc(db,'circles',circleId,'dailyDrops',targetDay,'answers',user.uid);
 const existing=await getDoc(answerRef);if(existing.exists())throw new Error('You have already posted today.');
 const payload={uid:user.uid,date:targetDay,prompt:safeText(prompt,300),answer:value,name:accountDisplayName(),createdAt:serverTimestamp()};
 if(photo)payload.photoDataUrl=photo;
 await setDoc(answerRef,payload);
 const ui=window.CircleApp;ui.state.drop.dayKey=targetDay;ui.state.drop.posted=true;ui.state.drop.answer=value;ui.state.drop.photoDataUrl=photo;
 if(dropAnswerStop){dropAnswerStop();dropAnswerStop=null}
 dropAnswerStop=onSnapshot(collection(db,'circles',circleId,'dailyDrops',targetDay,'answers'),snap=>{
  if(ui.state.drop.dayKey!==targetDay)return;
  ui.state.drop.entries=snap.docs.map(d=>({id:d.id,...d.data()}));ui.render()
 },e=>ui.toast('Daily Drop answers could not load: '+e.code));
 ui.render();
 ui.render();
}
const addRecord=async(name,data)=>addDoc(collection(db,'circles',circleId,name),{...data,uid:user.uid,createdAt:serverTimestamp()});
async function addCommitment(d){return addRecord('commitments',{text:safeText(d.task,240),by:accountDisplayName(),when:safeText(d.when,80),done:false})}
async function toggleCommitment(id,done){return updateDoc(doc(db,'circles',circleId,'commitments',String(id)),{done:!!done,updatedAt:serverTimestamp()})}
async function addMemory(d){return addRecord('memories',{type:safeText(d.type,30),icon:safeText(d.icon,8),title:safeText(d.title,100),desc:safeText(d.desc,1200),date:dayKey(),by:accountDisplayName(),color:safeText(d.color,20),unlockAt:d.unlockAt||null})}
async function addRitual(d){return addRecord('rituals',{title:safeText(d.title,100),day:safeText(d.day,3),detail:safeText(d.detail,240)})}
async function addQuest(d){return addRecord('quests',{title:safeText(d.title,100),desc:safeText(d.desc,300),icon:safeText(d.icon,8),doneBy:{}})}
async function toggleQuest(id,done){const ref=doc(db,'circles',circleId,'quests',String(id));await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(!snap.exists())throw new Error('Quest no longer exists.');const doneBy={...(snap.data().doneBy||{})};if(done)doneBy[user.uid]=true;else delete doneBy[user.uid];tx.update(ref,{doneBy})})}
async function addActivity(d){return addRecord('activities',{type:safeText(d.type,40),answer:safeText(d.answer,1500),unlock:safeText(d.unlock,40),title:safeText(d.title,100)})}
async function addTrack(d){
 const providerId=safeText(d.providerId,40),title=safeText(d.title,160),artist=safeText(d.artist,160);
 if(!providerId||!title||!artist)throw new Error('Track information is incomplete.');
 const tracks=await getDocs(query(collection(db,'circles',circleId,'tracks'),where('providerId','==',providerId),limit(1)));
 if(!tracks.empty)throw new Error('That song is already in the shared playlist.');
 return addRecord('tracks',{providerId,title,artist,album:safeText(d.album,160),artwork:safeText(d.artwork,1000),previewUrl:safeText(d.previewUrl,1000),trackUrl:safeText(d.trackUrl,1000),source:'itunes',durationMs:Math.max(0,Math.min(3600000,Number(d.durationMs)||0))});
}
async function removeTrack(id){const ref=doc(db,'circles',circleId,'tracks',String(id));await deleteDoc(ref)}

async function addQuietReply(toUid,messageId,reply){if(!toUid||toUid==='you'||toUid===user.uid)throw new Error('Quiet replies can only be sent to another circle member.');return addRecord('privateReplies',{fromUid:user.uid,toUid,messageId:String(messageId),reply:safeText(reply,1500)})}
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
  if(member.exists())await updateDoc(ref,{name:displayName,handle,bio,photoURL,email:deleteField()});
 }));
 profileData={...profileData,displayName,handle,bio,photoURL};
 return profileData;
}
async function setSupport(enabled,preference=''){return updateDoc(memberRef(),{support:!!enabled,supportPreference:safeText(preference,100),lastSeen:serverTimestamp()})}
async function createPlan(d){const options=String(d.options||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,8);if(!options.length)options.push('Let’s decide together');await addDoc(collection(db,'circles',circleId,'plans'),{title:safeText(d.title,100),description:safeText(d.description,500),date:safeText(d.date,10),time:options[0]||'',place:safeText(d.place,120),options,votes:{},rsvps:{},status:'Voting open',createdBy:user.uid,createdAt:serverTimestamp()})}
async function react(id,emoji){const allowed=['❤️','😂','😍','🥹','😭','😮','😡','👍','👎','🙌','👏','🔥','🎉','✨','💯','🫶','🤝','👀','🥳','💀','😎','🤔','🙏','💚','🤍','💛','🫡','🥰','😅','💖','🧡','💜'];if(!allowed.includes(emoji))throw new Error('That reaction is not available.');const r=doc(db,'circles',circleId,'messages',String(id));await runTransaction(db,async tx=>{const s=await tx.get(r);if(!s.exists())return;const all={...(s.data().reactionsByUser||{})},mine=Array.isArray(all[user.uid])?[...all[user.uid]]:[],i=mine.indexOf(emoji);if(i>=0)mine.splice(i,1);else mine.push(emoji);if(mine.length)all[user.uid]=mine;else delete all[user.uid];tx.update(r,{reactionsByUser:all})})}
async function votePlan(id,n){const r=doc(db,'circles',circleId,'plans',String(id));await runTransaction(db,async tx=>{const s=await tx.get(r);if(!s.exists())throw new Error('Plan no longer exists.');const d=s.data();if(Array.isArray(d.votes)||Array.isArray(d.rsvps))throw new Error('This older poll is read-only. Create a new plan to use voting.');if(!Number.isInteger(n)||n<0||n>=(d.options||[]).length)throw new Error('Option unavailable.');const votes={...(d.votes&&typeof d.votes==='object'&&!Array.isArray(d.votes)?d.votes:{})};votes[user.uid]=n;const rsvps={...(d.rsvps&&typeof d.rsvps==='object'&&!Array.isArray(d.rsvps)?d.rsvps:{})};rsvps[user.uid]=true;tx.update(r,{votes,rsvps})})}
async function rsvpPlan(id){const r=doc(db,'circles',circleId,'plans',String(id));await runTransaction(db,async tx=>{const s=await tx.get(r);if(!s.exists())throw new Error('Plan no longer exists.');if(Array.isArray(s.data().votes)||Array.isArray(s.data().rsvps))throw new Error('This older poll is read-only. Create a new plan to update RSVPs.');const rs={...(s.data().rsvps&&typeof s.data().rsvps==='object'&&!Array.isArray(s.data().rsvps)?s.data().rsvps:{})};rs[user.uid]=!rs[user.uid];tx.update(r,{rsvps:rs})})}
const memberRef=()=>doc(db,'circles',circleId,'members',user.uid);
async function setMood(mood){await updateDoc(memberRef(),{mood:String(mood).slice(0,8),lastSeen:serverTimestamp()})}
async function setAvailability(free,activity='',duration='2'){let freeUntil=null;if(free){const now=new Date(),hours=duration==='today'?Math.max(1,(new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).getTime()-now.getTime())/3600000):Math.max(1,Math.min(3,Number(duration)||2));freeUntil=new Date(now.getTime()+hours*3600000)}await updateDoc(memberRef(),{status:free?'free':'around',freeUntil,activity:safeText(activity,80),lastSeen:serverTimestamp()})}
async function leaveCircle(){
 if(!circleId)throw new Error('No circle is open.');
 const circleSnap=await getDoc(doc(db,'circles',circleId));
 if(circleSnap.data()?.ownerUid===user.uid)throw new Error('The owner cannot leave yet. Transfer ownership first.');
 const batch=writeBatch(db);
 batch.delete(doc(db,'circles',circleId,'members',user.uid));
 batch.delete(doc(db,'users',user.uid,'circles',circleId));
 await batch.commit();
 stop();circleId=null;saveActiveCircleId('');
 picker(await myCircles());
}
async function removeMember(targetUid){
 if(!circleId||!targetUid||targetUid===user.uid)throw new Error('Choose another circle member.');
 const circleSnap=await getDoc(doc(db,'circles',circleId));
 if(circleSnap.data()?.ownerUid!==user.uid)throw new Error('Only the circle owner can remove members.');
 const memberSnap=await getDoc(doc(db,'circles',circleId,'members',targetUid));
 if(!memberSnap.exists())throw new Error('That member is no longer in this circle.');
 const batch=writeBatch(db);
 batch.delete(doc(db,'circles',circleId,'members',targetUid));
 batch.delete(doc(db,'users',targetUid,'circles',circleId));
 await batch.commit();
}
async function rotateInvite(){
 if(!circleId)throw new Error('No circle is open.');
 const circleRef=doc(db,'circles',circleId),circleSnap=await getDoc(circleRef);
 if(circleSnap.data()?.ownerUid!==user.uid)throw new Error('Only the circle owner can replace its invite code.');
 const oldCode=circleSnap.data()?.inviteCode||'',newCode=makeCode(),batch=writeBatch(db);
 if(oldCode){const oldRef=doc(db,'invites',oldCode),oldSnap=await getDoc(oldRef);if(oldSnap.exists())batch.update(oldRef,{revokedAt:serverTimestamp()})}
 batch.update(circleRef,{inviteCode:newCode,updatedAt:serverTimestamp()});
 batch.set(doc(db,'invites',newCode),{circleId,circleName:safeText(circleSnap.data().name,40)||'Untitled circle',createdBy:user.uid,createdAt:serverTimestamp(),expiresAt:new Date(Date.now()+7*24*60*60*1000)});
 await batch.commit();
 return newCode;
}
async function signOutAndClear(){stop();circleId=null;saveActiveCircleId('');try{localStorage.removeItem('circle_demo_v1')}catch{}await signOut(auth)}
window.CircleCloud={saveProfile,prepareProfilePhoto,prepareDailyDropPhoto,prepareSticker,saveSticker,deleteSticker,sendSticker,backToCircles:async()=>{stop();circleId=null;picker(await myCircles())},leaveCircle,removeMember,rotateInvite,get circleId(){return circleId},get user(){return user},sendMessage,sendAttachment,createPlan,react,votePlan,rsvpPlan,setMood,setAvailability,addCommitment,toggleCommitment,addMemory,addRitual,addQuest,toggleQuest,addActivity,addTrack,removeTrack,addDropAnswer,addQuietReply,setSupport,enableBrowserNotifications,signOut:signOutAndClear,inviteCode:async()=>{const s=await getDoc(doc(db,'circles',circleId));return s.data()?.inviteCode||''}};
onAuthStateChanged(auth,async u=>{
 stop();user=u;
 if(!u){profileData={};circleId=null;saveActiveCircleId('');try{localStorage.removeItem('circle_demo_v1')}catch{}window.CircleApp?.clearSession?.();authScreen();return}
 try{
  try{localStorage.removeItem('circle_demo_v1')}catch{}
  const r=doc(db,'users',u.uid),p=await getDoc(r),saved=p.data()||{};
  const savedName=validDisplayName(saved.displayName,u.email),authName=validDisplayName(u.displayName,u.email),sessionName=validDisplayName(profileData.displayName,u.email);
  profileData={...profileData,...saved,displayName:savedName||authName||sessionName,email:u.email,photoURL:saved.photoURL||profileData.photoURL||u.photoURL||'',handle:saved.handle||profileData.handle||'',bio:saved.bio||profileData.bio||''};
  await setDoc(r,{displayName:profileData.displayName||'',email:u.email,photoURL:profileData.photoURL,handle:profileData.handle,bio:profileData.bio},{merge:true});
  if(!profileData.handle||!profileData.displayName){saveActiveCircleId('');profileSetupScreen();return}
  const circles=await myCircles();
  const savedCircleId=saved.activeCircleId||getSavedCircleId();
  const savedCircle=circles.find(item=>item.id===savedCircleId);
  const mostRecentlyJoined=[...circles].sort((a,b)=>{
   const stamp=value=>value?.toMillis?.()??(value?.seconds?value.seconds*1000:0);
   return stamp(b.joinedAt)-stamp(a.joinedAt);
  })[0];
  const defaultCircle=savedCircle||mostRecentlyJoined;
  if(defaultCircle){const opened=await openCircle(defaultCircle.id);if(opened)return;return}
  picker(circles);
 }catch(x){authScreen();error(`Firebase setup issue: ${x.code||x.message}. Enable Authentication and create a Firestore database.`)}
});
