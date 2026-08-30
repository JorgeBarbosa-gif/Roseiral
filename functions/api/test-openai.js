function json(data, init={}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {"content-type":"application/json; charset=utf-8", ...(init.headers||{})}
  });
}

function getOutputText(data){
  if(typeof data?.output_text==="string") return data.output_text;
  return "";
}

export async function onRequest(context){
  if(context.request.method!=="GET" && context.request.method!=="POST"){
    return json({error:"Método não permitido.",method:context.request.method},{status:405,headers:{Allow:"GET, POST"}});
  }

  if(!context.env.OPENAI_API_KEY){
    return json({error:"OPENAI_API_KEY não está disponível para esta Function.",code:"missing_openai_key"},{status:503});
  }

  try{
    const resp=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        "Authorization":`Bearer ${context.env.OPENAI_API_KEY}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        model:"gpt-5.6-luna",
        store:false,
        input:"Responda apenas OK."
      })
    });

    const data=await resp.json().catch(()=>({}));
    if(!resp.ok){
      return json({
        error:data?.error?.message||`OpenAI respondeu HTTP ${resp.status}`,
        code:data?.error?.code||null,
        type:data?.error?.type||null,
        request_id:data?.id||resp.headers.get("x-request-id")||null
      },{status:resp.status});
    }

    return json({ok:true,message:getOutputText(data)||"OK",request_id:data?.id||null});
  }catch(err){
    return json({error:err?.message||String(err),code:"function_fetch_error"},{status:500});
  }
}
