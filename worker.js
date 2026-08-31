const ALLOWED_ORIGIN = "https://rangerover500.github.io";
const MAX_BYTES = 2 * 1024 * 1024;
const AUDIO_EXTENSIONS = new Set(["aac","flac","m4a","mp3","mp4","mpeg","oga","ogg","wav","wave","webm"]);
const GENERIC_MEDIA_TYPES = new Set(["application/octet-stream","binary/octet-stream"]);

function mediaType(file){
  return String(file.type || "").split(";",1)[0].trim().toLowerCase();
}

function fileExtension(name){
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function isAudioFile(file){
  const type = mediaType(file);
  if(type && !GENERIC_MEDIA_TYPES.has(type)) return type.startsWith("audio/");
  return AUDIO_EXTENSIONS.has(fileExtension(file.name));
}

function transcriptionFilename(file){
  const type = mediaType(file);
  if(!type || GENERIC_MEDIA_TYPES.has(type)) return file.name || "rit.m4a";
  const subtype = type.slice("audio/".length);
  const extensions = {
    "aac":"aac", "flac":"flac", "m4a":"m4a", "mp4":"m4a",
    "mpeg":"mp3", "mp3":"mp3", "ogg":"ogg", "wav":"wav",
    "wave":"wav", "webm":"webm", "x-m4a":"m4a", "x-wav":"wav"
  };
  return "rit." + (extensions[subtype] || subtype.replace(/^x-/,"").replace(/[^a-z0-9]/g,"") || "audio");
}

function cors(origin){
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Rittenapp-Key",
    "Vary": "Origin",
    "Cache-Control": "no-store"
  };
}

function json(body,status=200,origin=ALLOWED_ORIGIN){
  return new Response(JSON.stringify(body),{
    status,
    headers:{...cors(origin),"Content-Type":"application/json; charset=utf-8"}
  });
}

export default {
  async fetch(request,env){
    const origin = request.headers.get("Origin") || "";
    if(request.method === "OPTIONS"){
      if(origin !== ALLOWED_ORIGIN) return new Response(null,{status:403});
      return new Response(null,{status:204,headers:cors(origin)});
    }
    if(request.method !== "POST") return json({error:"Alleen POST is toegestaan."},405,origin);
    if(origin !== ALLOWED_ORIGIN) return json({error:"Herkomst niet toegestaan."},403,ALLOWED_ORIGIN);
    if(!env.OPENAI_API_KEY || !env.RITTENAPP_SHARED_KEY) return json({error:"Worker is niet volledig geconfigureerd."},500,origin);
    if(request.headers.get("X-Rittenapp-Key") !== env.RITTENAPP_SHARED_KEY) return json({error:"Onjuiste spraakcode."},401,origin);

    const length = Number(request.headers.get("Content-Length") || 0);
    if(length && length > MAX_BYTES) return json({error:"Audio-opname is te groot."},413,origin);

    let incoming;
    try{ incoming = await request.formData(); }
    catch(_){ return json({error:"Ongeldige upload."},400,origin); }
    const file = incoming.get("file");
    if(!(file instanceof File) || !file.size) return json({error:"Geen audio ontvangen."},400,origin);
    if(file.size > MAX_BYTES) return json({error:"Audio-opname is te groot."},413,origin);
    if(!isAudioFile(file)) return json({error:"Bestand is geen audio."},415,origin);

    const form = new FormData();
    form.append("file",file,transcriptionFilename(file));
    form.append("model","gpt-transcribe");
    form.append("language","nl");
    form.append("prompt","Nederlandse rittenadministratie. Mogelijke namen: Breeland Rotterdam, Breeland Den Haag, Breeland Brielle, Breeland Dordrecht, ABS den Elzen, Perfect Carwrapping, Carwash Capelle. Transcriptie letterlijk en beknopt.");

    let response;
    try{
      response = await fetch("https://api.openai.com/v1/audio/transcriptions",{
        method:"POST",
        headers:{"Authorization":"Bearer " + env.OPENAI_API_KEY},
        body:form
      });
    }catch(_){ return json({error:"Transcriptiedienst is tijdelijk niet bereikbaar."},502,origin); }

    let data;
    try{ data = await response.json(); }
    catch(_){ return json({error:"Ongeldig antwoord van transcriptiedienst."},502,origin); }
    if(!response.ok) return json({error:"Transcriptiedienst weigerde de opname."},502,origin);
    const text = String(data?.text || "").trim();
    if(!text) return json({error:"Geen spraak herkend."},422,origin);
    return json({text},200,origin);
  }
};
