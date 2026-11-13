const errorPath='m10 3 8 14H2zM10 7v4m0 3v.3';
const paths={
  saved:'<circle cx="10" cy="10" r="7"/><path d="m6.5 10 2.3 2.3 4.7-4.8"/>',
  error:`<path d="${errorPath}"/>`,
  trash:'<path d="M4 6h12M8 3h4M6 6v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6"/>',
  image:'<rect x="3" y="3" width="14" height="14" rx="2"/><circle cx="7" cy="7" r="1"/><path d="m4 15 4-4 3 3 2-2 4 4"/>',
  table:'<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M3 8h14M3 12h14M10 4v12"/>',
  code:'<path d="m6 6-4 4 4 4m8-8 4 4-4 4M12 3l-4 14"/>',
  layout:'<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M6 7h8M6 10h8M6 13h5"/>',
  eye:'<path d="M2 10s3-5.5 8-5.5 8 5.5 8 5.5-3 5.5-8 5.5S2 10 2 10Z"/><circle cx="10" cy="10" r="2.5"/>',
  resize:'<path d="m5 15 10-10m-5 10 5-5"/>',
  edit:'<path d="m4 13 9-9 3 3-9 9-4 1zM11 6l3 3"/>'
};
export const desktopIcon=name=>`<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.saved}</svg>`;
export const saveState=text=>/失败|错误|冲突|未保存/.test(text)?'error':/保存中|正在/.test(text)?'saving':'saved';
const saveMotions=new WeakMap();
const params={amplitude:3.6, period:1, variation:85, ends:70, roundness:52, sweep:85};
const left = 4.3, knee = 8, right = 15.7;
const check = `M${left} 10.1 ${knee} 13.6 ${right} 6.4`;
const line = `M${left} 10H${right}`;
const rate = 32, damping = .75, turn = 2 * Math.PI;
const drag = rate * damping, frequency = rate * Math.sqrt(1 - damping ** 2);
const coastTime = 160, returnLead = 35;
const launchTravel = 180, launchPulse = 245;
const firstWaveAngle = -Math.PI * .72;
const ease = t => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
const makePoints = () => Array.from({length:13}, (_, i) => {
  const u = i / 12;
  const short = Math.min(1, 3 * u), long = Math.max(0, (3 * u - 1) / 2);
  const checkX = left + (knee - left) * short + (right - knee) * long;
  const checkY = 10.1 + 3.5 * short - 7.2 * long;
  return {u, lineX:left + (right - left) * u, checkX, checkY, x:checkX, y:checkY, vx:0, vy:0, hook:1, fromHook:1};
});
function newMotion(time) {
  return {phase:'saving', started:time, changed:time, last:time, angle:firstWaveAngle,
    waveClock:0, flowSpeed:1, incomingSpeed:1, points:makePoints()};
}
function setPhase(motion, next, time) {
  motion.phase = next;
  motion.changed = time;
  motion.incomingSpeed = motion.flowSpeed;
  motion.points.forEach(point => {
    point.fromHook = point.hook;
    point.landing = null;
  });
}
function glide(position, speed, target, seconds, duration) {
  const t = Math.min(1, seconds / duration), rest = 1 - t;
  const blend = t ** 3 * (10 - 15 * t + 6 * t * t);
  const tangent = t * rest ** 3 * (1 + 3 * t);
  return {
    position:position + (target - position) * blend + speed * duration * tangent,
    speed:(target - position) * 30 * t * t * rest * rest / duration
      + speed * rest * rest * (1 + 2 * t - 15 * t * t),
    blend
  };
}
function beginLanding(point, time) {
  const distance = point.checkY - point.y;
  const aligned = distance * point.vy > 0 && Math.abs(point.vy) > 1;
  point.landing = {
    time, x:point.x, y:point.y, vx:point.vx, vy:point.vy, hook:point.hook,
    verticalTime:aligned ? Math.max(.13, Math.min(.30, 2.2 * Math.abs(distance / point.vy))) : .28
  };
}
function advanceSaveMotion(motion, time) {
  const {phase, started, changed, last, incomingSpeed, points} = motion;
  const dt = (time - last) / 1000;
  const elapsed = time - changed;
  const returning = phase === 'settling';
  const waveDelta = (Math.max(0, time - started - 75) - Math.max(0, last - started - 75)) / 1000;
  motion.last = time;
  // Preserve the wave's current phase and slow its clock before the check takes shape.
  const nextSpeed = incomingSpeed + ((returning ? .7 : 1) - incomingSpeed) * ease(elapsed / coastTime);
  const waveAdvance = waveDelta * (motion.flowSpeed + nextSpeed) / 2;
  motion.flowSpeed = nextSpeed;
  motion.waveClock += waveAdvance;
  motion.angle += turn * waveAdvance / params.period;
  const seconds = motion.waveClock;
  const flow = motion.angle + .24 * Math.sin(turn * seconds / 3.8);
  const variation = params.variation / 100;
  const amplitude = params.amplitude + variation * .48 * Math.sin(turn * seconds / 3.2 - .65);
  const roundness = Math.max(0, Math.min(.11, params.roundness / 1000 + .018 * variation * Math.sin(turn * seconds / 4.4 + .5)));
  const balance = variation * .18 * Math.sin(turn * seconds / 4.7 + .8);
  const ends = params.ends / 100;
  const decay = Math.exp(-drag * dt);
  const cosine = Math.cos(frequency * dt), sine = Math.sin(frequency * dt) / frequency;
  let settled = returning;
  const turnBudget = Math.min(175, params.period * 220);
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const launchLag = launchTravel * point.u;
    if (returning) {
      const earliest = returnLead + params.sweep * point.u;
      const previous = points[i - 1]?.landing;
      const orderReady = !i || (previous && time >= previous.time + params.sweep / (points.length - 1));
      // A point can stay in the passing wave while it is still moving away from its landing height.
      const movingAway = (point.checkY - point.y) * point.vy < 0 && Math.abs(point.vy) > 2;
      if (!point.landing && elapsed >= earliest && orderReady && (!movingAway || elapsed >= earliest + turnBudget)) {
        beginLanding(point, time);
      }
      if (point.landing) {
        const from = point.landing, seconds = Math.max(0, (time - from.time) / 1000);
        const x = glide(from.x, from.vx, point.checkX, seconds, .27);
        const y = glide(from.y, from.vy, point.checkY, seconds, from.verticalTime);
        point.x = x.position;
        point.y = y.position;
        point.vx = x.speed;
        point.vy = y.speed;
        point.hook = from.hook + (1 - from.hook) * x.blend;
        settled &&= seconds >= Math.max(.27, from.verticalTime);
        continue;
      }
      settled = false;
    } else {
      point.hook = point.fromHook * (1 - ease((elapsed - launchLag) / 150));
    }
    const x = point.lineX + (point.checkX - point.lineX) * point.hook;
    const theta = turn * point.u - flow;
    const wave = Math.sin(theta) + roundness * Math.sin(3 * theta);
    const taper = ends + (1 - ends) * Math.sin(Math.PI * point.u);
    const waveRise = ease((1000 * seconds - launchLag) / 195);
    const waveY = 10 + waveRise * amplitude * taper * (wave + balance * wave * wave);
    // A small downward tug travels along the line with the unfolding check.
    const tugPhase = Math.max(0, Math.min(1, (time - started - launchLag) / launchPulse));
    const tug = .95 * Math.sin(Math.PI * tugPhase) ** 2;
    const y = waveY + (point.checkY - waveY) * point.hook + tug;
    // Solve the spring at the current target while retaining its incoming velocity.
    const dx = point.x - x, dy = point.y - y;
    point.x = x + decay * (dx * cosine + (point.vx + drag * dx) * sine);
    point.y = y + decay * (dy * cosine + (point.vy + drag * dy) * sine);
    point.vx = decay * (point.vx * cosine - (rate ** 2 * dx + drag * point.vx) * sine);
    point.vy = decay * (point.vy * cosine - (rate ** 2 * dy + drag * point.vy) * sine);
  }
  if (settled) {
    motion.phase = 'saved';
    return check;
  }
  return 'M' + points.map(point => point.x.toFixed(2) + ' ' + point.y.toFixed(2)).join('L');
}


function setStaticSavePath(path,state){
  path.setAttribute('d',state==='error'?errorPath:state==='saving'?line:check);
}

function animateSavePath(element,path,state,previousState,reducedMotion){
  const now=performance.now();
  const phase=state==='saving'?'saving':'settling';
  const running=saveMotions.get(element);
  if(running){
    setPhase(running,phase,running.last);
    return;
  }

  const motion=newMotion(now);
  if(previousState==='saving'){
    for(const point of motion.points){
      point.x=point.lineX;
      point.y=10;
      point.hook=0;
    }
  }
  setPhase(motion,phase,now);
  saveMotions.set(element,motion);
  const step=1000/120;

  function paint(time){
    if(!element.isConnected||reducedMotion.matches){
      setStaticSavePath(path,element.dataset.state);
      saveMotions.delete(element);
      return;
    }
    // Use the preview's time step and bound catch-up work after a suspended frame.
    const steps=Math.min(12,Math.floor((time-motion.last)/step));
    let shape;
    for(let i=0;i<steps&&motion.phase!=='saved';i++){
      shape=advanceSaveMotion(motion,motion.last+step);
    }
    if(time-motion.last>=step&&motion.phase!=='saved'){
      const skipped=time-motion.last;
      motion.last+=skipped;
      motion.started+=skipped;
      motion.changed+=skipped;
      for(const point of motion.points)if(point.landing)point.landing.time+=skipped;
    }
    if(shape)path.setAttribute('d',shape);
    if(motion.phase==='saved')saveMotions.delete(element);
    else motion.frame=requestAnimationFrame(paint);
  }
  motion.frame=requestAnimationFrame(paint);
}

export function renderDesktopSaveStatus(element,text){
  if(!element)return;
  const next=saveState(text),previous=element.dataset.state;
  element.classList.add('desktop-save-state');
  element.setAttribute('role','status');element.setAttribute('aria-label',text);element.title=text;
  let icon=element.querySelector('svg[data-note-save-icon]');
  if(!icon){
    element.innerHTML=desktopIcon('saved')
      .replace('<svg ','<svg data-note-save-icon="" ')
      .replace(paths.saved,'<path/>');
    icon=element.firstElementChild;
    element._alignNoteHeader?.();
  }else if(next===previous)return;

  element.dataset.state=next;
  icon.setAttribute('viewBox',next==='error'?'1 2 18 16':'2 2 16 16');
  const path=icon.firstElementChild;
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const shouldAnimate=(next==='saving'||next==='saved'&&previous==='saving')
    && previous!=='error'&&element.getClientRects().length>0&&!reducedMotion.matches;
  if(shouldAnimate){
    if(!path.hasAttribute('d'))setStaticSavePath(path,previous||'saved');
    animateSavePath(element,path,next,previous,reducedMotion);
  }else{
    const running=saveMotions.get(element);
    if(running){
      cancelAnimationFrame(running.frame);
      saveMotions.delete(element);
    }
    setStaticSavePath(path,next);
  }
}
