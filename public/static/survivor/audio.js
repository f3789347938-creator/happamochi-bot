export class Sound {
 constructor(){this.enabled=false;this.context=null;this.master=null;this.last={};this.voices=0;this.noiseBuffer=null;try{this.enabled=localStorage.getItem('mochi-survivor-sound')==='on';}catch{}}
 async unlock(){if(!this.enabled)return;try{if(!this.context){this.context=new (window.AudioContext||window.webkitAudioContext)();this.master=this.context.createGain();this.master.gain.value=.72;const limiter=this.context.createDynamicsCompressor();limiter.threshold.value=-16;limiter.knee.value=14;limiter.ratio.value=8;this.master.connect(limiter);limiter.connect(this.context.destination);this.noiseBuffer=this.context.createBuffer(1,Math.floor(this.context.sampleRate*.2),this.context.sampleRate);const data=this.noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.sin(i*12.9898)*Math.sin(i*78.233);}if(this.context.state==='suspended')await this.context.resume();}catch{}}
 toggle(){this.enabled=!this.enabled;try{localStorage.setItem('mochi-survivor-sound',this.enabled?'on':'off');}catch{}if(this.enabled){void this.unlock().then(()=>this.play('level'));}return this.enabled;}
 envelope(source,start,length,volume){if(this.voices>=36)return false;const gain=this.context.createGain();gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(volume,start+.004);gain.gain.exponentialRampToValueAtTime(.0001,start+length);source.connect(gain);gain.connect(this.master);this.voices++;source.onended=()=>{this.voices--;source.disconnect();gain.disconnect();};source.start(start);source.stop(start+length+.015);return true;}
 tone(hz,end,start,length=.13,volume=.06,type='sine'){const o=this.context.createOscillator();o.type=type;o.frequency.setValueAtTime(hz,start);o.frequency.exponentialRampToValueAtTime(Math.max(30,end),start+length);this.envelope(o,start,length,volume);}
 noise(start,length=.08,volume=.035){if(!this.noiseBuffer)return;const source=this.context.createBufferSource();source.buffer=this.noiseBuffer;this.envelope(source,start,length,volume);}
 play(kind,detail={}){
  if(!this.enabled||!this.context||this.context.state!=='running'||!this.master)return;const now=this.context.currentTime,interval={shot:.1,impact:.095,kill:.075,xp:.09,meteor:.2,multikill:.42,milestone:.7}[kind]||.2;if(now-(this.last[kind]??-10)<interval)return;this.last[kind]=now;
  if(kind==='shot'){
   const weapon=detail.weapon||'kunai';
   if(['bat','katana','lightchaser'].includes(weapon)){this.noise(now,.085,.045);this.tone(1100,160,now,.1,.035,'triangle');this.tone(260,90,now+.015,.08,.035);}
   else if(['shotgun','revolver'].includes(weapon)){this.noise(now,.09,.055);this.tone(170,45,now,.12,.085,'triangle');this.tone(1900,480,now,.025,.024,'square');}
   else if(weapon==='void'){this.tone(180,50,now,.22,.08,'triangle');this.tone(520,180,now,.15,.025);}
   else{this.tone(weapon==='sword'?1200:1050,380,now,.06,.043,'triangle');}return;
  }
  if(kind==='throw'){this.noise(now,.09,.022);this.tone(650,160,now,.1,.02,'triangle');return;}
  if(kind==='bottleBreak'){this.noise(now,.07,.04);[2800,3700,4900].forEach((hz,i)=>this.tone(hz,hz*.6,now+i*.014,.06,.018,'triangle'));this.tone(170,55,now+.025,.18,.05);return;}
  if(kind==='impact'){this.tone(1500,430,now,.025,.022,'triangle');if(detail.heavy){this.noise(now,.035,.025);this.tone(170,65,now,.075,.043,'triangle');}return;}
  if(kind==='meteor'){this.noise(now,.17,.075);this.tone(145,32,now,.26,.12,'triangle');this.tone(1300,260,now,.035,.025);return;}
  if(kind==='multikill'){const lift=detail.kills>=15?1.5:detail.kills>=8?1.25:1;[523,784,1046].forEach((hz,i)=>this.tone(hz*lift,hz*lift*1.05,now+i*.035,.13,.055));this.tone(160,50,now,.19,.065,'triangle');return;}
  if(kind==='kill'){const hz=450+Math.min(12,detail.combo||0)*28;this.tone(hz,hz*1.4,now,.065,.035);return;}
  const notes={xp:[1100],hurt:[150,90],level:[523,659,784,1046],evolution:[392,523,659,784,1046,1568],milestone:[659,880,1318],shield:[820,1040],heal:[660,880],win:[523,659,784,1046,1318],lose:[350,262,196],wave:[392,523]}[kind];if(!notes)return;
  if(kind==='evolution'){this.tone(100,50,now,.35,.11,'triangle');this.noise(now,.13,.04);}
  notes.forEach((hz,i)=>this.tone(hz,hz*(kind==='xp'?1.08:.92),now+i*.065,kind==='xp'?.065:.19,kind==='xp'?.025:.065,kind==='hurt'?'triangle':'sine'));
 }
 suspend(){if(this.context?.state==='running')void this.context.suspend();}
}
