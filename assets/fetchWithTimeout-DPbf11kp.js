async function i(e,n={},o=15e3){const t=new AbortController,r=setTimeout(()=>t.abort(),o);try{return await fetch(e,{...n,signal:t.signal})}finally{clearTimeout(r)}}export{i as f};
