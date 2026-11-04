const waitFor = (fn, tries=0) => {
  if (window.CircleApp && window.CircleCloud?.addTrack) return fn();
  if (tries < 120) setTimeout(() => waitFor(fn, tries+1), 250);
};
const esc = value => String(value ?? '');
const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
let results=[], queryText='', searching=false, errorText='', busyId='';
function style(){
 if(document.getElementById('circleMusicStyles'))return;
 const s=el('style');s.id='circleMusicStyles';s.textContent=`
 #circleMusic{margin-top:16px;padding:20px;background:var(--surface,#fffefa);border:1px solid var(--line,#e8e6dc);border-radius:20px}
 #circleMusic .cm-head{display:flex;justify-content:space-between;align-items:start;gap:12px;margin-bottom:14px}
 #circleMusic h2{font:800 19px Manrope,sans-serif;margin:0;color:var(--ink)}
 #circleMusic p{font-size:11px;color:var(--muted);margin:5px 0 0}
 #circleMusic form{display:flex;gap:8px;margin:14px 0}
 #circleMusic input{min-width:0;flex:1;border:1px solid var(--line);border-radius:10px;padding:11px 12px;background:var(--surface);color:var(--ink);font:12px 'DM Sans',sans-serif}
 #circleMusic button{border:0;border-radius:10px;padding:10px 13px;background:var(--green);color:#fff;font-size:11px;font-weight:700}
 #circleMusic button.cm-secondary{background:#e7eee4;color:#35543c}
 #circleMusic button:disabled{opacity:.5}
 #circleMusic .cm-list{display:grid;gap:9px}
 #circleMusic .cm-track{display:flex;align-items:center;gap:11px;padding:10px;border:1px solid var(--line);border-radius:13px;min-width:0}
 #circleMusic .cm-art{width:48px;height:48px;object-fit:cover;border-radius:8px;background:#eee;flex:none}
 #circleMusic .cm-info{min-width:0;flex:1}
 #circleMusic .cm-info strong,#circleMusic .cm-info span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 #circleMusic .cm-info strong{font-size:12px;color:var(--ink)}
 #circleMusic .cm-info span{font-size:10px;color:var(--muted);margin-top:3px}
 #circleMusic audio{width:100%;height:30px;margin-top:7px}
 #circleMusic .cm-muted{font-size:11px;color:var(--muted);padding:12px 2px}
 #circleMusic .cm-results{margin-bottom:18px}
 @media(max-width:600px){#circleMusic .cm-track{align-items:flex-start}#circleMusic .cm-track>button{padding:8px}}
 `;document.head.append(s);
}
function openTrack(url){if(!url)return;const safe=String(url);if(/^https:\/\//i.test(safe))window.open(safe,'_blank','noopener,noreferrer');}
function makeTrack(item, added=false){
 const row=el('article','cm-track');
 const art=el('img','cm-art');art.alt='';art.loading='lazy';art.src=item.artworkUrl100||item.artwork||'';
 const info=el('div','cm-info');info.append(el('strong','',item.trackName||item.title||'Unknown track'),el('span','',item.artistName||item.artist||'Unknown artist'));
 if(item.previewUrl){const audio=el('audio');audio.controls=true;audio.preload='none';audio.src=item.previewUrl;audio.setAttribute('aria-label','Preview '+(item.trackName||item.title||'song'));info.append(audio);}
 else info.append(el('span','','No preview available — open the track to listen.'));
 row.append(art,info);
 const actions=el('div');actions.style.display='grid';actions.style.gap='6px';
 if(!added){const add=el('button','cm-secondary',busyId===String(item.trackId)?'Adding…':'＋ Add');add.disabled=busyId===String(item.trackId);add.addEventListener('click',async()=>{busyId=String(item.trackId);render();try{await window.CircleCloud.addTrack({providerId:String(item.trackId),title:item.trackName,artist:item.artistName,album:item.collectionName||'',artwork:item.artworkUrl100||'',previewUrl:item.previewUrl||'',trackUrl:item.trackViewUrl||'',source:'itunes',durationMs:item.trackTimeMillis||0});}catch(e){errorText='Could not add song: '+(e.code||e.message); }finally{busyId='';render();}});actions.append(add);}
 if(added&&item.uid===window.CircleCloud.user?.uid){const remove=el('button','cm-secondary','Remove');remove.addEventListener('click',async()=>{try{await window.CircleCloud.removeTrack(item.id);render();}catch(e){errorText='Could not remove song: '+(e.code||e.message);render();}});actions.append(remove);}
 const link=el('button','cm-secondary','Open ↗');link.addEventListener('click',()=>openTrack(item.trackViewUrl||item.trackUrl));actions.append(link);row.append(actions);return row;
}
function render(){
 style();const view=document.getElementById('view');if(!view)return;
 let panel=document.getElementById('circleMusic');
 if(!panel){panel=el('section');panel.id='circleMusic';const grid=view.querySelector('.activity-grid');if(!grid)return;grid.after(panel);}
 panel.replaceChildren();
 const head=el('div','cm-head'),copy=el('div');copy.append(el('h2','','Circle soundtrack'),el('p','','Find songs, add them together, and play previews or open the full track.'));head.append(copy,el('span','tag green','SHARED PLAYLIST'));panel.append(head);
 const form=el('form');form.setAttribute('role','search');const input=el('input');input.type='search';input.placeholder='Search songs, artists or albums…';input.value=queryText;input.setAttribute('aria-label','Search songs, artists or albums');const submit=el('button','','Search');submit.type='submit';submit.disabled=searching||!input.value.trim();input.addEventListener('input',()=>{submit.disabled=searching||!input.value.trim();});form.append(input,submit);form.addEventListener('submit',e=>{e.preventDefault();queryText=input.value.trim();search(queryText);});panel.append(form);
 if(errorText)panel.append(el('div','cm-muted',errorText));
 if(results.length){const resultWrap=el('div','cm-results');resultWrap.append(el('div','card-title','Search results'));const list=el('div','cm-list');results.forEach(t=>list.append(makeTrack(t,false)));resultWrap.append(list);panel.append(resultWrap);}
 panel.append(el('div','section-row',''));const playlistTitle=el('div','card-title','Songs added by your circle');panel.append(playlistTitle);
 const tracks=[...(window.CircleApp.state.tracks||[])].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
 if(!tracks.length)panel.append(el('div','cm-muted','Your shared playlist is empty. Search for a song and add the first one.'));
 else{const list=el('div','cm-list');tracks.forEach(t=>list.append(makeTrack({id:t.id,uid:t.uid,trackId:t.providerId,trackName:t.title,artistName:t.artist,artworkUrl100:t.artwork,previewUrl:t.previewUrl,trackViewUrl:t.trackUrl},true)));panel.append(list);}
}
async function search(q){
 if(!q)return;searching=true;errorText='';render();
 try{
  const url='https://itunes.apple.com/search?term='+encodeURIComponent(q)+'&entity=song&limit=15&country=in';
  const response=await fetch(url);if(!response.ok)throw new Error('Music search is temporarily unavailable.');
  const data=await response.json();results=Array.isArray(data.results)?data.results.filter(x=>x.trackId&&x.trackName):[];
  if(!results.length)errorText='No matching songs found. Try another artist or title.';
 }catch(e){errorText=e.message||'Could not search songs right now.';results=[];}
 finally{searching=false;render();}
}
function mount(){
 const view=document.getElementById('view');if(!view)return;
 if(window.CircleApp.state.view==='activities')render();
}
waitFor(()=>{
 const observer=new MutationObserver(()=>{if(window.CircleApp.state.view==='activities'&&!document.getElementById('circleMusic'))mount();});
 observer.observe(document.getElementById('view')||document.body,{childList:true,subtree:true});
 mount();
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action="playlist"]');if(!b)return;
  e.preventDefault();e.stopImmediatePropagation();window.CircleApp.setView('activities');
  setTimeout(()=>document.getElementById('circleMusic')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
 },true);
});
