// RMS envelope for timeline previews and overall waveform strength.
// Precomputation makes seeks, preview and export reproduce the same frame.
export function analyseEnvelope(channels, sampleRate, fps = 60) {
  if (!channels.length || !channels[0].length) return new Float32Array();
  const length = channels[0].length;
  const count = Math.ceil(length / sampleRate * fps);
  const levels = new Float32Array(count);
  let peak = 0;
  for (let frame = 0; frame < count; frame++) {
    const begin = Math.floor(frame * sampleRate / fps);
    const end = Math.min(length, Math.floor((frame + 1) * sampleRate / fps));
    let energy = 0;
    for (const samples of channels) {
      for (let i = begin; i < end; i++) energy += samples[i] * samples[i];
    }
    const rms = Math.sqrt(energy / Math.max(1, (end - begin) * channels.length));
    levels[frame] = rms;
    peak = Math.max(peak, rms);
  }
  // Keep near-silent recordings quiet rather than amplifying their noise to full scale.
  const scale = Math.max(peak, 0.05);
  const attack = 1 - Math.exp(-1 / (fps * 0.035));
  const release = 1 - Math.exp(-1 / (fps * 0.16));
  let smoothed = 0;
  for (let i = 0; i < levels.length; i++) {
    const target = levels[i] < 0.0005 ? 0 : Math.min(1, levels[i] / scale);
    smoothed += (target - smoothed) * (target > smoothed ? attack : release);
    levels[i] = smoothed;
  }
  return levels;
}
// Frequency energy is measured independently across the current audio window.
// No travelling history buffer or procedural waves: every frame is tied to audio time.
export async function analyseBands(channels, sampleRate, fps = 30, bands = 64) {
  const n = 2048, frames = Math.ceil((channels[0]?.length || 0) / sampleRate * fps);
  const values = new Float32Array(frames * bands);
  const re = new Float64Array(n), im = new Float64Array(n), power = new Float64Array(n / 2);
  const window = Float64Array.from({length:n}, (_,i)=>.5-.5*Math.cos(2*Math.PI*i/(n-1)));
  const reverse = new Uint16Array(n);
  for(let i=0;i<n;i++){let x=i,y=0;for(let b=0;b<11;b++){y=(y<<1)|(x&1);x>>=1}reverse[i]=y}
  const smooth = new Float32Array(bands);
  const attack=1-Math.exp(-1/(fps*.025)), release=1-Math.exp(-1/(fps*.09));
  for(let frame=0;frame<frames;frame++){
    power.fill(0);
    const start=Math.round(frame*sampleRate/fps)-n/2;
    for(const samples of channels){
      for(let i=0;i<n;i++){re[reverse[i]]=(samples[start+i]||0)*window[i];im[i]=0}
      for(let size=2;size<=n;size*=2){
        const angle=-2*Math.PI/size,wr=Math.cos(angle),wi=Math.sin(angle);
        for(let block=0;block<n;block+=size){let ar=1,ai=0;
          for(let j=0;j<size/2;j++){
            const a=block+j,b=a+size/2,br=re[b]*ar-im[b]*ai,bi=re[b]*ai+im[b]*ar;
            re[b]=re[a]-br;im[b]=im[a]-bi;re[a]+=br;im[a]+=bi;
            const next=ar*wr-ai*wi;ai=ar*wi+ai*wr;ar=next;
          }
        }
      }
      for(let k=1;k<n/2;k++)power[k]+=(re[k]*re[k]+im[k]*im[k])/channels.length;
    }
    for(let b=0;b<bands;b++){
      const frequency=70*Math.pow(Math.min(10000,sampleRate*.45)/70,b/(bands-1));
      const bin=frequency*n/sampleRate,lo=Math.max(1,Math.floor(bin*.88)),hi=Math.min(n/2-1,Math.ceil(bin*1.12));
      let energy=0;for(let k=lo;k<=hi;k++)energy+=power[k];
      const magnitude=Math.sqrt(energy/(hi-lo+1))*4/n;
      const target=Math.max(0,Math.min(1,(20*Math.log10(Math.max(1e-8,magnitude))+65)/60));
      smooth[b]+=(target-smooth[b])*(target>smooth[b]?attack:release);
      values[frame*bands+b]=smooth[b];
    }
    if(frame%120===119)await new Promise(resolve=>setTimeout(resolve,0));
  }
  return {values,frames,bands,fps};
}

export function spectrumBarLevels(spectrum, envelope, time, count, envelopeFps=60){
  if(!spectrum?.frames)return Array(count).fill(0);
  const at=Math.max(0,Math.min(spectrum.frames-1,time*spectrum.fps)),frame=Math.floor(at),blend=at-frame;
  const next=Math.min(spectrum.frames-1,frame+1), {bands,values}=spectrum;
  const envAt=Math.max(0,Math.min(envelope.length-1,time*envelopeFps)),ei=Math.floor(envAt),ef=envAt-ei;
  const loudness=Math.pow(Math.max(0,(envelope[ei]||0)*(1-ef)+(envelope[Math.min(ei+1,envelope.length-1)]||0)*ef),.6);
  const smoothed=Array.from({length:bands},(_,b)=>{
    let sum=0,weight=0;
    for(let d=-3;d<=3;d++){const k=Math.max(0,Math.min(bands-1,b+d)),w=4-Math.abs(d);sum+=w*(values[frame*bands+k]*(1-blend)+values[next*bands+k]*blend);weight+=w}
    return sum/weight;
  });
  const peak=Math.max(.12,...smoothed);
  return Array.from({length:count},(_,i)=>{
    const x=i/Math.max(1,count-1)*(bands-1),b=Math.floor(x),f=x-b;
    const energy=smoothed[b]*(1-f)+smoothed[Math.min(b+1,bands-1)]*f;
    return loudness*(.5+.5*energy/peak);
  });
}
