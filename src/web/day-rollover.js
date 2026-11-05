import {dateKey} from './model.js';
// Check the local calendar day after throttling/sleep as well as at midnight.
export function watchLocalDay({onChange,now=()=>new Date(),schedule=setTimeout,cancel=clearTimeout,windowTarget=window,documentTarget=document}){
 let day=dateKey(now()),timer=null,disposed=false;
 function check(){
  if(disposed)return;cancel(timer);const current=now(),next=dateKey(current);
  if(next!==day){const previous=day;day=next;onChange(next,previous,current)}
  const midnight=new Date(current.getFullYear(),current.getMonth(),current.getDate()+1);
  timer=schedule(check,Math.max(50,Math.min(60000,midnight-current+25)));
 }
 const events=[[windowTarget,'focus'],[windowTarget,'pageshow'],[documentTarget,'visibilitychange']];
 for(const [target,event] of events)target.addEventListener(event,check);
 check();return {check,dispose(){disposed=true;cancel(timer);for(const [target,event] of events)target.removeEventListener(event,check)}};
}
