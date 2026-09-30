import {exportConfig,chooseExportType} from './export-settings.js?v=1.4';
import {parseTime,stamp,parseSrt,toSrt,activeCue,defaults,layouts,validateSettings} from './core.js';
import {analyseEnvelope, analyseBands, spectrumBarLevels} from './waveform.js?v=1.3';
import {sanitiseTrack,mixTracks,encodeWav} from './mixer.js';
const $=id=>document.getElementById(id),canvas=$('canvas'),ctx=canvas.getContext('2d');let settings={...defaults},cues=[],audioFile=null,audioUrl=null,audioBuffer=null,envelope=[],spectrum=null,logoData=null,logo=new Image(),audioCtx,source,previewGain,recordDest,recorder,exporting=false,cancelled=false,lastActive=null,videoUrl=null,loading=false;const audio=new Audio();audio.preload='auto';logo.src='savi-logo.png';const settingsKeys=Object.keys(defaults);let dirty=false;function invalidateVideo(){dirty=true;$('downloadVideo').hidden=true;}const status=(s,error=false)=>{$('status').textContent=s;$('status').classList.toggle('error',error)};const timeLabel=t=>{const seconds=Math.floor(Math.max(0,t)+0.001);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`};const duration=()=>Number.isFinite(audio.duration)?audio.duration:0;
function syncControls(){invalidateVideo();for(const k of settingsKeys){const el=$(k);if(el.type==='checkbox')el.checked=settings[k];else el.value=settings[k];const out=$(k+'Out');if(out)out.value=settings[k]+(['titleSize','captionSize'].includes(k)?'':'%')}const [w,h]=settings.format==='landscape'?[1920,1080]:settings.format==='portrait'?[1080,1920]:[1080,1080];canvas.width=w;canvas.height=h;$('dimensions').textContent=`${w} × ${h}`}
for(const k of settingsKeys)$(k).addEventListener('input',()=>{settings[k]=$(k).type==='checkbox'?$(k).checked:$(k).type==='range'?+$(k).value:$(k).value;if(k==='format')Object.assign(settings,layouts[settings.format]);syncControls()});
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-selected',String(t===b))});document.querySelectorAll('.tab-panel').forEach(p=>p.hidden=p.id!==b.dataset.tab)});
$('resetLayout').onclick=()=>{Object.assign(settings,layouts[settings.format]);syncControls()};
function ensureAudio(){if(!audioCtx){audioCtx=new AudioContext();source=audioCtx.createMediaElementSource(audio);previewGain=audioCtx.createGain();source.connect(previewGain);previewGain.connect(audioCtx.destination)}return audioCtx.resume()}
let primaryTrack=null,backgroundTracks=[],mixing=false;
const samplesOf=buffer=>Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
function setMixLock(locked){
 mixing=locked;document.body.classList.toggle('mixing',locked);
 for(const sel of ['.audio-mixer','.transport','.header-actions','.uploads','.timeline'])document.querySelector(sel).inert=locked;
}
async function decodeTrack(file,options={}){
 if(file.size>250*1024*1024)throw new Error('Use audio files smaller than 250 MB.');
 await ensureAudio();
 const buffer=await audioCtx.decodeAudioData(await file.arrayBuffer());
 if(!buffer.length)throw new Error('This audio has no duration.');
 return {id:crypto.randomUUID(),file,buffer,thumbnail:analyseEnvelope(samplesOf(buffer),buffer.sampleRate,15),...sanitiseTrack(options)};
}
async function rebuildMix(){
 if(!primaryTrack){renderTracks();return}
 const previousTime=audio.currentTime||0,resume=!audio.paused;audio.pause();setMixLock(true);invalidateVideo();
 let nextUrl=null;
 try{
  $('mixStatus').textContent='Updating audio mix and analysing waveform…';
  await new Promise(resolve=>setTimeout(resolve,0));
  const tracks=[primaryTrack,...backgroundTracks];
  const mixed=mixTracks(tracks.map(track=>({...track,samples:samplesOf(track.buffer),startFrame:Math.round(track.offset*audioCtx.sampleRate)})),primaryTrack.buffer.length,2);
  const wav=new Blob([encodeWav(mixed.samples,audioCtx.sampleRate)],{type:'audio/wav'});
  nextUrl=URL.createObjectURL(wav);
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{clean();reject(new Error('Timed out loading the audio mix.'))},15000);
   const ok=()=>{clean();resolve()},bad=()=>{clean();reject(new Error('Your browser could not play the audio mix.'))};
   function clean(){clearTimeout(timer);audio.removeEventListener('loadedmetadata',ok);audio.removeEventListener('error',bad)}
   audio.addEventListener('loadedmetadata',ok);audio.addEventListener('error',bad);audio.src=nextUrl;
  });
  if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=nextUrl;nextUrl=null;
  audioFile=primaryTrack.file;audioBuffer=primaryTrack.buffer;
  envelope=analyseEnvelope(mixed.samples,audioCtx.sampleRate);
  spectrum=await analyseBands(mixed.samples,audioCtx.sampleRate);
  $('audioName').textContent=primaryTrack.file.name;$('play').disabled=false;$('seek').disabled=false;$('timelineEmpty').hidden=true;
  drawTimeline();renderTracks();audio.currentTime=Math.min(previousTime,duration());
  $('mixStatus').textContent=mixed.reduction<1?`Mix ready · Peak protection reduced the output by ${(-20*Math.log10(mixed.reduction)).toFixed(1)} dB to prevent distortion.`:'Mix ready · Preview and export use these exact track levels.';
  status(`${tracks.length} audio ${tracks.length===1?'track':'tracks'} · ${timeLabel(duration())}`);warnCaptions();
  if(resume)await audio.play();
 }catch(e){if(nextUrl)URL.revokeObjectURL(nextUrl);if(audioUrl)audio.src=audioUrl;throw e}finally{setMixLock(false)}
}
async function refreshMix(){try{await rebuildMix()}catch(e){status('Could not update mix: '+e.message,true)}}
async function loadAudio(file){
 if(!file||exporting||loading||mixing)return false;
 if(file.size+backgroundTracks.reduce((sum,t)=>sum+t.file.size,0)>250*1024*1024){status('Keep the combined audio uploads under 250 MB.',true);return false}
 loading=true;setMixLock(true);const old=primaryTrack;
 try{status('Reading podcast audio…');const track=await decodeTrack(file);primaryTrack=track;audio.pause();audio.currentTime=0;await rebuildMix();return true}
 catch(e){primaryTrack=old;status('Could not load podcast: '+e.message,true);return false}
 finally{loading=false;setMixLock(false)}
}
function drawTrackWave(canvas,track){
 const levels=track.thumbnail,g=canvas.getContext('2d');
 g.fillStyle=track===primaryTrack?'#a58bde':'#d381b3';
 const total=primaryTrack?.buffer.duration||track.buffer.duration;
 for(let i=0;i<160;i++){
  const time=i/160*total-track.offset;if(time<0||(!track.loop&&time>=track.buffer.duration))continue;
  const sourceTime=track.loop?time%track.buffer.duration:time,index=Math.min(levels.length-1,Math.floor(sourceTime*15));
  const height=Math.max(2,(levels[index]||0)*28);g.fillRect(i*4,(32-height)/2,2,height);
 }
}
function renderTracks(){
 const root=$('audioLayers');root.replaceChildren();
 for(const track of [primaryTrack,...backgroundTracks].filter(Boolean)){
  const main=track===primaryTrack,row=document.createElement('div');row.className='audio-track'+(main?' podcast':'');
  const top=document.createElement('div');top.className='track-top';
  const kind=document.createElement('span');kind.className='track-kind';kind.textContent=main?'PODCAST':'BACKGROUND';
  const name=document.createElement('span');name.className='track-name';name.textContent=track.file.name;name.title=track.file.name;
  const mute=document.createElement('button');mute.className='track-mute';mute.textContent=track.muted?'Unmute':'Mute';mute.setAttribute('aria-label',(track.muted?'Unmute ':'Mute ')+track.file.name);mute.setAttribute('aria-pressed',String(track.muted));mute.onclick=()=>{track.muted=!track.muted;refreshMix()};
  top.append(kind,name,mute);
  if(!main){const remove=document.createElement('button');remove.className='track-remove';remove.textContent='×';remove.setAttribute('aria-label','Remove '+track.file.name);remove.onclick=()=>{backgroundTracks=backgroundTracks.filter(t=>t!==track);invalidateVideo();refreshMix()};top.append(remove)}
  const wave=document.createElement('canvas');wave.className='track-wave';wave.width=640;wave.height=32;wave.setAttribute('aria-label',track.file.name+' waveform');
  const controls=document.createElement('div');controls.className='track-controls';
  const volume=document.createElement('label');volume.className='volume-control';volume.append('Volume ');
  const output=document.createElement('output');output.textContent=Math.round(track.gain*100)+'%';volume.append(output);
  const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='200';slider.step='1';slider.value=String(Math.round(track.gain*100));slider.setAttribute('aria-label',track.file.name+' volume');
  slider.oninput=()=>{track.gain=+slider.value/100;output.textContent=slider.value+'%';invalidateVideo()};slider.onchange=refreshMix;volume.append(slider);controls.append(volume);
  if(!main){
   const start=document.createElement('label');start.className='start-control';start.append('Start (sec)');const number=document.createElement('input');number.type='number';number.min='0';number.max='86400';number.step='.1';number.value=String(track.offset);number.setAttribute('aria-label',track.file.name+' start time');number.onchange=()=>{track.offset=Math.max(0,Math.min(86400,+number.value||0));refreshMix()};start.append(number);
   const loop=document.createElement('label');loop.className='loop-control';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=track.loop;checkbox.onchange=()=>{track.loop=checkbox.checked;refreshMix()};loop.append(checkbox,'Loop');controls.append(start,loop);
  }
  row.append(top,wave,controls);root.append(row);drawTrackWave(wave,track);
 }
}
$('layerFiles').onchange=async e=>{
 const files=[...e.target.files];if(!files.length||mixing||exporting)return;
 if(backgroundTracks.length+files.length>8){status('You can add up to eight background audio tracks.',true);e.target.value='';return}
 if(files.reduce((n,f)=>n+f.size,0)+backgroundTracks.reduce((n,t)=>n+t.file.size,0)+(primaryTrack?.file.size||0)>250*1024*1024){status('Keep the combined audio uploads under 250 MB.',true);e.target.value='';return}
 setMixLock(true);
 try{status('Reading background audio…');const added=[];for(const file of files)added.push(await decodeTrack(file,{gain:.2}));backgroundTracks.push(...added);invalidateVideo();await rebuildMix();if(!primaryTrack)status('Background tracks added. Upload your podcast to hear the mix.')}
 catch(e){status('Could not add audio: '+e.message,true)}finally{setMixLock(false);e.target.value='';renderTracks()}
};
$('audioFile').onchange=e=>loadAudio(e.target.files[0]);for(const event of ['dragenter','dragover'])$('audioDrop').addEventListener(event,e=>{e.preventDefault();$('audioDrop').style.borderColor='#b5ed69'});$('audioDrop').ondragleave=()=>{$('audioDrop').style.borderColor=''};$('audioDrop').ondrop=e=>{e.preventDefault();$('audioDrop').style.borderColor='';loadAudio(e.dataTransfer.files[0])};
async function readSrt(file){if(!file)return;try{if(file.size>5*1024*1024)throw new Error('The SRT file is too large.');const parsed=parseSrt(await file.text());if(!parsed.cues.length)throw new Error('No valid timed captions found. Use standard SRT timecodes.');cues=parsed.cues;$('srtName').textContent=file.name;renderCues();status(`${cues.length} captions imported${parsed.skipped?' · '+parsed.skipped+' invalid blocks skipped.':'.'}`);warnCaptions()}catch(e){status(e.message,true)}}$('srtFile').onchange=e=>readSrt(e.target.files[0]);
function warnCaptions(){if(duration()&&cues.some(c=>c.end>duration()+.1))status('Some captions extend beyond the audio. Review their end times before export.',true)}
function readData(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('File could not be read.'));r.readAsDataURL(file)})}
async function setLogo(data){const next=new Image();await new Promise((res,rej)=>{next.onload=res;next.onerror=()=>rej(new Error('Artwork could not be loaded.'));next.src=data||'savi-logo.png'});invalidateVideo();logo=next;logoData=data;$('logoThumb').src=next.src}
$('logoFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>15*1024*1024)throw new Error('Please use artwork smaller than 15 MB.');await setLogo(await readData(f));status('Artwork updated.')}catch(e){status(e.message,true)}};$('resetLogo').onclick=()=>setLogo(null);
function fitText(text,x,y,max,size,colour){ctx.fillStyle=colour;ctx.font=`${size}px "${settings.font}"`;while(ctx.measureText(text).width>max&&size>15){size--;ctx.font=`${size}px "${settings.font}"`}ctx.fillText(text,x,y)}
function captionLines(text,size,maxWidth){ctx.font=`${size}px "${settings.font}"`;const lines=[];let wordIndex=0;for(const paragraph of text.split('\n')){let line=[],width=0;for(const word of paragraph.split(/\s+/).filter(Boolean)){const w=ctx.measureText(word).width,space=ctx.measureText(' ').width;if(line.length&&width+space+w>maxWidth){lines.push(line);line=[];width=0}line.push({word,index:wordIndex++,width:w});width+=w+(line.length>1?space:0)}if(line.length)lines.push(line)}return lines}
function paint(t){const w=canvas.width,h=canvas.height,u=Math.min(w,h)/1080;ctx.fillStyle=settings.bg;ctx.fillRect(0,0,w,h);ctx.textBaseline='top';fitText(settings.title,w*.067,h*.086,w*.866,settings.titleSize*u,settings.fg);fitText(settings.subtitle,w*.067,h*.15,w*.866,settings.titleSize*.88*u,settings.secondary);const size=Math.min(w,h)*settings.logoSize/100,x=Math.min(w-size,w*settings.logoX/100),y=Math.min(h-size,h*settings.logoY/100);if(logo.complete&&logo.naturalWidth){ctx.save();ctx.beginPath();ctx.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);ctx.clip();ctx.drawImage(logo,x,y,size,size);ctx.restore()}
 const cue=activeCue(cues,t),sample=!cues.length&&!audioFile;const text=cue?.text||(sample?'Every race.\nEvery rivalry.\nYour story.':'');$('sampleBadge').hidden=!sample;
 if(text){const cx=w*settings.captionX/100,cy=h*settings.captionY/100,cw=Math.min(w*.96-cx,w*settings.captionWidth/100),ch=Math.max(60,h*.77-cy);let fs=settings.captionSize*u,lines=captionLines(text,fs,cw);while((lines.length*fs*1.2>ch||lines.some(l=>l.reduce((s,q)=>s+q.width,0)+Math.max(0,l.length-1)*ctx.measureText(' ').width>cw))&&fs>14){fs--;lines=captionLines(text,fs,cw)}const words=lines.flat().length,highlight=cue?Math.min(words-1,Math.floor((t-cue.start)/(cue.end-cue.start)*words)):2;ctx.font=`${fs}px "${settings.font}"`;lines.forEach((line,i)=>{let tx=cx;for(const item of line){ctx.fillStyle=settings.highlight==='line'||settings.highlight==='word'&&item.index===highlight?settings.accent:settings.fg;ctx.fillText(item.word,tx,cy+i*fs*1.2);tx+=item.width+ctx.measureText(' ').width}})}
 const base=h*(settings.progress ? .942 : 1),wh=h*settings.waveHeight/100,bars=Math.floor(w/(8*u));
 if(settings.waveStyle!=='none'){
   const values=spectrumBarLevels(spectrum,envelope,t,bars);
   ctx.fillStyle=settings.accent;ctx.strokeStyle=settings.accent;ctx.lineWidth=3*u;ctx.beginPath();
   for(let i=0;i<bars;i++){
     const bh=Math.max(2*u,wh*values[i]),bx=i*w/bars;
     if(settings.waveStyle==='bars')ctx.fillRect(bx,base-bh,Math.max(2,4*u),bh);
     else if(i===0)ctx.moveTo(bx,base-bh);else ctx.lineTo(bx,base-bh);
   }
   if(settings.waveStyle==='line')ctx.stroke();
 }
 if(settings.progress){ctx.fillStyle='#373a36';ctx.fillRect(0,base,w,h-base);ctx.fillStyle=settings.secondary;ctx.fillRect(0,base,w*(duration()?Math.min(1,t/duration()):0),h-base)}
}
function drawTimeline(){const c=$('timeline'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);g.fillStyle='#93bb68';for(let i=0;i<300;i++){const start=Math.floor(i*envelope.length/300),end=Math.max(start+1,Math.floor((i+1)*envelope.length/300));let max=0;for(let j=start;j<end;j++)max=Math.max(max,envelope[j]||0);const height=Math.max(2,max*52);g.fillRect(i*4,(65-height)/2,2,height)}}
function tick(){const t=audio.currentTime||0;paint(t);$('clock').innerHTML=`${timeLabel(t)} <span>/ ${timeLabel(duration())}</span>`;$('seek').value=duration()?t/duration()*100:0;$('timelineCursor').style.left=(duration()?t/duration()*100:0)+'%';$('play').textContent=audio.paused?'▶':'Ⅱ';$('play').setAttribute('aria-label',audio.paused?'Play audio':'Pause audio');const active=activeCue(cues,t)?.id;if(lastActive!==active){document.querySelectorAll('.cue').forEach(el=>el.classList.toggle('active',el.dataset.id===active));lastActive=active}if(exporting){const p=duration()?t/duration()*100:0;$('renderProgress').value=p;$('exportLabel').textContent=`Rendering video · ${Math.round(p)}%`}requestAnimationFrame(tick)}
$('play').onclick=async()=>{try{await ensureAudio();if(audio.paused){if(audio.currentTime>=duration())audio.currentTime=0;await audio.play()}else audio.pause()}catch(e){status(e.message,true)}};$('seek').oninput=()=>{if(duration())audio.currentTime=+$('seek').value/100*duration()};$('timelineWrap').onclick=e=>{if(duration()){const r=$('timelineWrap').getBoundingClientRect();audio.currentTime=Math.max(0,Math.min(duration(),(e.clientX-r.left)/r.width*duration()))}};$('mute').onclick=()=>{audio.muted=!audio.muted;$('mute').textContent=audio.muted?'×':'♪';$('mute').setAttribute('aria-label',audio.muted?'Unmute preview':'Mute preview')};
function renderCues(){invalidateVideo();const list=$('captionList');list.replaceChildren();$('captionCount').textContent=cues.length;$('captionEmpty').hidden=!!cues.length;const search=$('search').value.toLowerCase();cues.forEach((cue,index)=>{if(search&&!cue.text.toLowerCase().includes(search))return;const row=document.createElement('div');row.className='cue';row.dataset.id=cue.id;const head=document.createElement('div');head.className='cue-head';const jump=document.createElement('button');jump.className='cue-jump';jump.textContent=String(index+1).padStart(2,'0');jump.title='Jump to caption';jump.onclick=()=>{if(duration())audio.currentTime=Math.min(cue.start,duration());else status('Upload audio to preview this time.')};head.append(jump);for(const field of ['start','end']){const input=document.createElement('input');input.value=stamp(cue[field]);input.setAttribute('aria-label',`Caption ${index+1} ${field} time`);input.onchange=()=>{const n=parseTime(input.value);if(!Number.isFinite(n)||n<0||(field==='end'?n<=cue.start:n>=cue.end)){input.value=stamp(cue[field]);status('Use a valid timecode, with the end after the start.',true);return}invalidateVideo();cue[field]=n;input.value=stamp(n);warnCaptions()};head.append(input);if(field==='start'){const sep=document.createElement('span');sep.textContent='›';head.append(sep)}}const del=document.createElement('button');del.className='cue-delete';del.textContent='×';del.setAttribute('aria-label',`Delete caption ${index+1}`);del.onclick=()=>{cues=cues.filter(c=>c.id!==cue.id);renderCues()};head.append(del);const area=document.createElement('textarea');area.value=cue.text;area.setAttribute('aria-label',`Caption ${index+1} text`);area.oninput=()=>{invalidateVideo();cue.text=area.value};row.append(head,area);list.append(row)});lastActive=null}
function addCaption(){$('search').value='';const start=audio.currentTime||0;cues.push({id:crypto.randomUUID(),start,end:start+3,text:'Your caption here.'});cues.sort((a,b)=>a.start-b.start);renderCues();$('captionList').lastElementChild?.querySelector('textarea')?.focus()}$('addCaption').onclick=addCaption;$('manualCaption').onclick=addCaption;$('search').oninput=renderCues;
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}
const filename=()=>((settings.title+' '+settings.subtitle).replace(/[^a-zA-Z0-9 _-]/g,'').trim()||'audiogram');$('downloadSrt').onclick=()=>{if(!cues.length){status('Add captions or upload an SRT first.',true);return}download(new Blob([toSrt(cues)],{type:'text/plain;charset=utf-8'}),filename()+'.srt')};
async function packTrack(track){return {name:track.file.name,type:track.file.type,data:await readData(track.file),...sanitiseTrack(track)}}
$('saveProject').onclick=async()=>{
 const btn=$('saveProject');btn.disabled=true;status('Preparing project with all audio layers…');
 try{const project={version:2,settings,cues,logo:logoData,audio:primaryTrack?await packTrack(primaryTrack):null,layers:await Promise.all(backgroundTracks.map(packTrack))};download(new Blob([JSON.stringify(project)],{type:'application/json'}),filename()+'.savi.json');status('Project downloaded with all audio layers and mix settings.')}
 catch(e){status('Could not save project: '+e.message,true)}finally{btn.disabled=false}
};
$('loadProjectBtn').onclick=()=>$('projectFile').click();
async function unpackTrack(saved){
 if(!saved||typeof saved.data!=='string'||!/^data:(audio\/[\w.+-]+|video\/mp4|application\/octet-stream)?;base64,/.test(saved.data))throw new Error('Invalid audio in project.');
 const blob=await(await fetch(saved.data)).blob();
 return decodeTrack(new File([blob],String(saved.name||'audio.wav'),{type:blob.type}),saved);
}
$('projectFile').onchange=async e=>{
 const f=e.target.files[0];if(!f||exporting||mixing)return;setMixLock(true);
 try{
  if(f.size>360*1024*1024)throw new Error('Project is too large.');
  const p=JSON.parse(await f.text());
  if(![1,2].includes(p.version)||!p.settings||!Array.isArray(p.cues))throw new Error('This is not a SAVI Studio project.');
  const validated=p.cues.map(c=>{if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start||typeof c.text!=='string')throw new Error('Invalid caption in project.');return {id:crypto.randomUUID(),start:c.start,end:c.end,text:c.text}});
  if(p.logo&&!/^data:image\/(png|jpeg|webp);base64,/.test(p.logo))throw new Error('Invalid artwork.');
  if(p.layers&&(!Array.isArray(p.layers)||p.layers.length>8))throw new Error('Invalid background layers.');
  status('Restoring project and audio layers…');
  const restoredPrimary=p.audio?await unpackTrack(p.audio):null,restoredLayers=[];
  for(const layer of p.layers||[])restoredLayers.push(await unpackTrack(layer));
  if(restoredPrimary){restoredPrimary.offset=0;restoredPrimary.loop=false}
  // Validate all inputs before replacing the existing project.
  const newLogo=new Image();await new Promise((resolve,reject)=>{newLogo.onload=resolve;newLogo.onerror=()=>reject(new Error('Artwork could not be loaded.'));newLogo.src=p.logo||'savi-logo.png'});
  audio.pause();primaryTrack=restoredPrimary;backgroundTracks=restoredLayers;
  settings=validateSettings(p.settings);cues=validated;logo=newLogo;logoData=p.logo||null;$('logoThumb').src=logo.src;
  if(primaryTrack){audio.currentTime=0;await rebuildMix()}
  else{audio.removeAttribute('src');audio.load();if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=null;audioFile=null;audioBuffer=null;envelope=[];spectrum=null;$('audioName').textContent='MP3, WAV, M4A or audio from MP4';$('play').disabled=true;$('seek').disabled=true;$('timelineEmpty').hidden=false;drawTimeline();$('mixStatus').textContent='Upload your podcast to hear the mix.'}
  syncControls();renderCues();renderTracks();$('srtName').textContent=cues.length+' captions from project';status('Project opened with all audio layers.');warnCaptions();
 }catch(e){status('Could not open project: '+e.message,true)}finally{setMixLock(false);e.target.value=''}
};
function exportType(){return window.MediaRecorder?chooseExportType($('exportContainer').value,t=>MediaRecorder.isTypeSupported(t)):null}
function selectedExport(){return exportConfig({resolution:$('exportResolution').value,quality:$('exportQuality').value,audio:$('exportAudio').value},settings.format,duration())}
function updateExportEstimate(){const o=selectedExport(),mime=exportType();$('exportEstimate').textContent=`${o.width} × ${o.height} · 30 fps · ${(o.video/1e6).toFixed(1)} Mbps video · ${Math.round(o.audio/1000)} kbps audio · approximately ${o.estimatedMB.toFixed(1)} MB. ${mime?(mime.startsWith('video/mp4')?'MP4 with AAC audio.':'WebM with Opus audio.'):'This format is unavailable in your browser. Choose Automatic or WebM.'}`;$('startExport').disabled=!mime}
for(const id of ['exportResolution','exportQuality','exportAudio','exportContainer'])$(id).onchange=updateExportEstimate;
$('closeExport').onclick=()=>$('exportDialog').close();
function setExportLock(locked){
  exporting=locked;
  document.body.classList.toggle('exporting',locked);
  for(const selector of ['.settings','.captions','.header-actions','.transport','.timeline','.audio-mixer'])document.querySelector(selector).inert=locked;
  $('exportProgress').hidden=!locked;
}
let cancelReason='';
function cancelExport(reason){
  if(!exporting)return;
  cancelled=true;cancelReason=reason;
  audio.pause();
  if(recorder?.state==='recording')recorder.stop();
}
async function seekToStart(){
  if(audio.currentTime===0&&!audio.seeking)return;
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{cleanup();reject(new Error('Could not seek to the start of the audio.'))},5000);
    const done=()=>{cleanup();resolve()};
    function cleanup(){clearTimeout(timeout);audio.removeEventListener('seeked',done)}
    audio.addEventListener('seeked',done);audio.currentTime=0;
  });
}
async function exportVideo(){
  if(exporting)return;
  if(loading||mixing){status('Wait until your audio has finished loading.',true);return}
  if(!audioFile||!duration()){status('Upload audio before exporting.',true);return}
  const mime=exportType(),options=selectedExport();
  if(!mime||!canvas.captureStream){status('Video export is unavailable in this browser. Try current Chrome or Edge.',true);return}
  if(cues.some(c=>!c.text.trim())){status('Remove empty captions or add text before exporting.',true);return}
  if(document.hidden){status('Keep this tab visible during export.',true);return}
  let stream,wakeLock,watchdog,oldTime=audio.currentTime,oldMuted=audio.muted;
  const originalWidth=canvas.width,originalHeight=canvas.height;
  let exportError=null;
  const onError=()=>{exportError=new Error('Audio playback failed during export.');cancelExport(exportError.message)};
  cancelled=false;cancelReason='';$('exportDialog').close();setExportLock(true);
  try{
    await ensureAudio();audio.pause();await seekToStart();
    audio.muted=false;previewGain.gain.value=oldMuted?0:1;
    canvas.width=options.width;canvas.height=options.height;paint(0);
    recordDest=audioCtx.createMediaStreamDestination();source.connect(recordDest);
    stream=canvas.captureStream(30);
    for(const track of recordDest.stream.getAudioTracks())stream.addTrack(track);
    recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:options.video,audioBitsPerSecond:options.audio});
    const chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    const finished=new Promise(resolve=>{
      recorder.onstop=resolve;
      recorder.onerror=e=>{exportError=new Error(e.error?.message||'Video recording failed.');resolve()};
    });
    $('downloadVideo').hidden=true;$('renderProgress').value=0;
    status('Exporting video. Keep this tab visible.');
    try{wakeLock=await navigator.wakeLock?.request('screen')}catch{}
    if(cancelled){status(cancelReason||'Export cancelled.');return}
    audio.addEventListener('error',onError);
    audio.onended=()=>{paint(duration());if(recorder?.state==='recording')recorder.stop()};
    let previous=0,lastAdvance=performance.now();
    watchdog=setInterval(()=>{
      if(audio.currentTime>previous){previous=audio.currentTime;lastAdvance=performance.now()}
      else if(performance.now()-lastAdvance>15000){exportError=new Error('Audio playback stalled. Please try exporting again.');cancelExport(exportError.message)}
    },1000);
    recorder.start(1000);await audio.play();await finished;audio.pause();
    if(exportError)throw exportError;
    if(cancelled){status(cancelReason||'Export cancelled. Your project is unchanged.');return}
    const actualMime=recorder.mimeType||mime;
    const blob=new Blob(chunks,{type:actualMime});
    if(!blob.size)throw new Error('No video data was recorded.');
    if(videoUrl)URL.revokeObjectURL(videoUrl);videoUrl=URL.createObjectURL(blob);
    const mp4=actualMime.startsWith('video/mp4'),link=$('downloadVideo');
    link.href=videoUrl;link.download=filename()+(mp4?'.mp4':'.webm');
    link.textContent=`Download ${mp4?'MP4':'WebM'} · ${(blob.size/1048576).toFixed(1)} MB`;
    link.hidden=false;link.click();status('Video ready. Use the download button to save another copy.');
  }catch(e){status('Export failed: '+e.message,true)}finally{
    clearInterval(watchdog);audio.removeEventListener('error',onError);
    if(recorder?.state==='recording')recorder.stop();
    audio.pause();audio.onended=null;
    if(recordDest)source.disconnect(recordDest);
    stream?.getTracks().forEach(t=>t.stop());recordDest=null;recorder=null;
    audio.muted=oldMuted;if(previewGain)previewGain.gain.value=1;
    canvas.width=originalWidth;canvas.height=originalHeight;
    audio.currentTime=Math.min(oldTime,duration());paint(audio.currentTime);setExportLock(false);
    try{await wakeLock?.release()}catch{}
  }
}
$('exportBtn').onclick=()=>{if(loading||mixing||exporting)return;if(!audioFile){status('Upload audio before exporting.',true);return}updateExportEstimate();$('exportDialog').showModal()};
$('startExport').onclick=exportVideo;
$('cancelExport').onclick=()=>cancelExport('Export cancelled. Your project is unchanged.');
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelExport('Export cancelled because the tab was hidden. Keep it visible during export.')});
window.addEventListener('beforeunload',e=>{if(dirty||audioFile||cues.length){e.preventDefault();e.returnValue=''}});
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'configure_audiogram',title:'Edit audiogram details',description:'Update the visible show title and episode details.',inputSchema:{type:'object',properties:{title:{type:'string'},subtitle:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>{if(exporting)throw new Error('Wait for export to finish.');if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['title','subtitle'].includes(k)||typeof input[k]!=='string'||input[k].length>200))throw new Error('Use title and subtitle strings up to 200 characters.');Object.assign(settings,input);syncControls();return {title:settings.title,subtitle:settings.subtitle}}})).catch(()=>{})}catch{}}
syncControls();renderCues();dirty=false;requestAnimationFrame(tick);
