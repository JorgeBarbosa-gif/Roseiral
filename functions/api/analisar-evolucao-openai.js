function json(data, init={}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {"content-type":"application/json; charset=utf-8", ...(init.headers||{})}
  });
}

function getOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const chunks=[];
  for (const item of (data?.output||[])) {
    for (const c of (item?.content||[])) {
      if (typeof c?.text === "string") chunks.push(c.text);
    }
  }
  return chunks.join("\n").trim();
}

export async function onRequestPost({request, env}) {
  if (!env.OPENAI_API_KEY) {
    return json({error:"OPENAI_API_KEY não está configurada no Cloudflare."},{status:503});
  }

  let body;
  try { body=await request.json(); }
  catch { return json({error:"JSON inválido."},{status:400}); }

  const imageUrls=Array.isArray(body.imageUrls)
    ? body.imageUrls.filter(u=>typeof u==="string" && u.startsWith("http")).slice(0,3)
    : [];
  const contexto=body.contexto||{};

  if(!imageUrls.length) return json({error:"Nenhuma foto foi enviada para análise."},{status:400});

  const prompt=`Você é um assistente de apoio ao manejo de um roseiral.
Analise visualmente a foto principal da lavoura.
NÃO forneça diagnóstico definitivo de praga, doença ou deficiência.
Descreva somente sinais visuais, hipóteses e pontos que merecem inspeção em campo.

Contexto:
Talhão: ${contexto.talhao||"-"}
Data: ${contexto.data||"-"}
Estágio informado: ${contexto.estagio||"-"}
Observações do produtor: ${contexto.observacoes||"-"}
Hastes estimadas pelo produtor: ${contexto.hastes_estimadas??"-"}

Regras:
- Seja conservador e honesto quando a imagem não permitir concluir algo.
- "pragas_possiveis" deve usar termos como "sinais compatíveis com..." ou "não foi possível observar sinais claros de...".
- "nivel_atencao" deve ser BAIXO, MEDIO ou ALTO.
- "confianca_visual" deve ser BAIXA, MEDIA ou ALTA.
- Só estime hastes se houver base visual/contextual razoável; senão null.
- Só informe previsão de colheita em YYYY-MM-DD se houver base suficiente; senão null.
- relatorio_ia deve ser curto e deixar claro que é análise visual orientativa.`;

  const schema={
    type:"object",
    additionalProperties:false,
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
    required:[
      "condicao_visual","desenvolvimento","hastes_estimadas",
      "previsao_colheita","pragas_possiveis","nivel_atencao",
      "confianca_visual","relatorio_ia"
    ]
  };

  const inputContent=[
    {type:"input_text", text:prompt},
    {type:"input_image", image_url:imageUrls[0], detail:"auto"}
  ];

  // Optional additional photos can be included, while the first remains the principal.
  for(const u of imageUrls.slice(1)){
    inputContent.push({type:"input_image", image_url:u, detail:"low"});
  }

  try{
    const apiResp=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        "Authorization":`Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        model:"gpt-5.6-luna",
        store:false,
        input:[{role:"user",content:inputContent}],
        text:{
          format:{
            type:"json_schema",
            name:"roseiral_evolucao",
            strict:true,
            schema
          }
        }
      })
    });

    const data=await apiResp.json().catch(()=>({}));
    if(!apiResp.ok){
      return json({
        error:data?.error?.message||`OpenAI respondeu HTTP ${apiResp.status}`
      },{status:apiResp.status});
    }

    const text=getOutputText(data);
    if(!text) return json({error:"A OpenAI não retornou texto de análise."},{status:502});

    let analysis;
    try { analysis=JSON.parse(text); }
    catch {
      return json({error:"A OpenAI retornou uma resposta que não pôde ser interpretada como JSON."},{status:502});
    }

    return json({analysis});
  }catch(err){
    return json({error:err?.message||String(err)},{status:500});
  }
}
