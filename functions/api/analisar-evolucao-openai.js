function json(data, init={}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {"content-type":"application/json; charset=utf-8", ...(init.headers||{})}
  });
}

function getOutputText(data){
  if(typeof data?.output_text==="string") return data.output_text;
  const chunks=[];
  for(const item of (data?.output||[])){
    for(const c of (item?.content||[])){
      if(typeof c?.text==="string") chunks.push(c.text);
    }
  }
  return chunks.join("\n").trim();
}

function normalizeDate(value){
  if(typeof value!=="string") return null;
  const m=value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return null;
  const [y,mo,d]=[Number(m[1]),Number(m[2]),Number(m[3])];
  const dt=new Date(Date.UTC(y,mo-1,d));
  if(dt.getUTCFullYear()!==y || dt.getUTCMonth()!==mo-1 || dt.getUTCDate()!==d) return null;
  return value.trim();
}

function normalizeAttention(value){
  const v=String(value||"").trim().toUpperCase();
  return ["BAIXO","MEDIO","ALTO"].includes(v)?v:null;
}

function normalizeConfidence(value){
  const v=String(value||"").trim().toUpperCase();
  return ["BAIXA","MEDIA","ALTA"].includes(v)?v:null;
}

export async function onRequest({request,env}){
  if(request.method!=="POST")
    return json({error:"Método não permitido.",method:request.method},{status:405,headers:{Allow:"POST"}});

  if(!env.OPENAI_API_KEY)
    return json({error:"OPENAI_API_KEY não está disponível para esta Function.",code:"missing_openai_key"},{status:503});

  let body;
  try{body=await request.json()}catch{return json({error:"JSON inválido."},{status:400})}

  const imageUrls=Array.isArray(body.imageUrls)
    ? body.imageUrls.filter(u=>typeof u==="string"&&u.startsWith("http")).slice(0,3):[];
  const contexto=body.contexto||{};
  if(!imageUrls.length)return json({error:"Nenhuma foto foi enviada para análise."},{status:400});

  const prompt=`Você é um assistente de apoio ao manejo de um roseiral.
Analise visualmente a foto principal. Não dê diagnóstico definitivo de praga, doença ou deficiência.
Aponte somente sinais visuais, hipóteses e pontos que merecem inspeção em campo.

Talhão: ${contexto.talhao||"-"}
Data: ${contexto.data||"-"}
Estágio: ${contexto.estagio||"-"}
Observações: ${contexto.observacoes||"-"}
Hastes informadas: ${contexto.hastes_estimadas??"-"}

Regras obrigatórias:
- Não invente informações.
- previsao_colheita deve ser uma data ISO exata YYYY-MM-DD somente se houver base suficiente; caso contrário use null.
- hastes_estimadas deve ser número somente se houver base razoável; caso contrário null.
- nivel_atencao deve ser BAIXO, MEDIO ou ALTO.
- confianca_visual deve ser BAIXA, MEDIA ou ALTA.
- relatorio_ia deve deixar claro que é uma análise visual orientativa.`;

  const schema={
    type:"object",additionalProperties:false,
    properties:{
      condicao_visual:{type:["string","null"]},
      desenvolvimento:{type:["string","null"]},
      hastes_estimadas:{type:["number","null"]},
      previsao_colheita:{type:["string","null"]},
      pragas_possiveis:{type:["string","null"]},
      nivel_atencao:{type:["string","null"]},
      confianca_visual:{type:["string","null"]},
      relatorio_ia:{type:["string","null"]}
    },
    required:["condicao_visual","desenvolvimento","hastes_estimadas","previsao_colheita","pragas_possiveis","nivel_atencao","confianca_visual","relatorio_ia"]
  };

  const content=[
    {type:"input_text",text:prompt},
    {type:"input_image",image_url:imageUrls[0],detail:"auto"}
  ];
  for(const u of imageUrls.slice(1))content.push({type:"input_image",image_url:u,detail:"low"});

  try{
    const imageCall=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        "Authorization":`Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        model:"gpt-5.6-luna",
        store:false,
        input:[{role:"user",content}],
        text:{format:{type:"json_schema",name:"roseiral_evolucao",strict:true,schema}}
      })
    });

    const data=await imageCall.json().catch(()=>({}));
    if(!imageCall.ok){
      return json({
        error:data?.error?.message||`OpenAI respondeu HTTP ${imageCall.status}`,
        code:data?.error?.code||null,
        type:data?.error?.type||null,
        request_id:data?.id||imageCall.headers.get("x-request-id")||null
      },{status:imageCall.status});
    }

    const text=getOutputText(data);
    if(!text)return json({error:"A OpenAI não retornou texto de análise.",request_id:data?.id||null},{status:502});

    let raw;
    try{raw=JSON.parse(text)}
    catch{return json({error:"A OpenAI retornou uma resposta que não pôde ser interpretada como JSON.",request_id:data?.id||null},{status:502})}

    // Normalize values before the browser/Supabase ever sees them.
    const analysis={
      condicao_visual: typeof raw.condicao_visual==="string" ? raw.condicao_visual.trim() : null,
      desenvolvimento: typeof raw.desenvolvimento==="string" ? raw.desenvolvimento.trim() : null,
      hastes_estimadas: (typeof raw.hastes_estimadas==="number" && Number.isFinite(raw.hastes_estimadas)) ? raw.hastes_estimadas : null,
      previsao_colheita: normalizeDate(raw.previsao_colheita),
      pragas_possiveis: typeof raw.pragas_possiveis==="string" ? raw.pragas_possiveis.trim() : null,
      nivel_atencao: normalizeAttention(raw.nivel_atencao),
      confianca_visual: normalizeConfidence(raw.confianca_visual),
      relatorio_ia: typeof raw.relatorio_ia==="string" ? raw.relatorio_ia.trim() : null
    };

    return json({analysis,request_id:data?.id||null});
  }catch(err){
    return json({error:err?.message||String(err),code:"openai_fetch_error"},{status:500});
  }
}
