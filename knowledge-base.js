const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, 'workflows');

const BASE_PERSONALITY = `Eres el asistente AI interno de Pixelflakes en Slack, especializado en resolver dudas sobre los workflows creados en Weavy.

Reglas de comportamiento:
- Responde siempre en espanol salvo que te hablen en otro idioma
- Se directo y practico. En Slack la gente quiere respuestas rapidas
- Usa formato Slack: *negrita*, _cursiva_, \`codigo\`, \`\`\`bloques de codigo\`\`\`
- Si no estas seguro de algo, dilo claramente
- Cuando des instrucciones, usa pasos numerados
- Si detectas un posible bug del workflow, indicalo
- Sugiere mejoras cuando veas oportunidades
- Usa emojis de Slack con moderacion para hacer las respuestas mas legibles
- Manten las respuestas concisas - si necesitas dar mucho detalle, estructura con secciones claras
- Si la pregunta es muy compleja, ofrece resolver por partes`;

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return null;
  }
}

function loadAllWorkflows() {
  if (!fs.existsSync(WORKFLOWS_DIR)) {
    fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
    return [];
  }
  const dirs = fs.readdirSync(WORKFLOWS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  return dirs.map(dirName => {
    const wfDir = path.join(WORKFLOWS_DIR, dirName);
    return {
      id: dirName,
      name: dirName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description: readFileIfExists(path.join(wfDir, 'description.txt')) || 'Sin descripcion',
      systemPrompt: readFileIfExists(path.join(wfDir, 'system-prompt.txt')),
      commonIssues: readFileIfExists(path.join(wfDir, 'common-issues.txt')),
      notes: readFileIfExists(path.join(wfDir, 'notes.txt')),
    };
  }).filter(wf => wf.description !== 'Sin descripcion' || wf.systemPrompt);
}

function buildSystemPrompt() {
  const workflows = loadAllWorkflows();
  let prompt = `${BASE_PERSONALITY}\n\n`;
  prompt += `# Workflows que conoces (${workflows.length} total)\n\n`;
  if (workflows.length === 0) {
    prompt += `No hay workflows cargados todavia. Responde con tu conocimiento general sobre Weavy y automatizaciones.\n`;
    return prompt;
  }
  workflows.forEach((wf, i) => {
    prompt += `## ${i + 1}. ${wf.name}\n`;
    prompt += `Descripcion: ${wf.description}\n`;
    if (wf.systemPrompt) {
      const maxLen = 3000;
      const truncated = wf.systemPrompt.length > maxLen
        ? wf.systemPrompt.substring(0, maxLen) + '\n[... prompt truncado por longitud ...]'
        : wf.systemPrompt;
      prompt += `System Prompt del LLM:\n${truncated}\n`;
    }
    if (wf.commonIssues) {
      prompt += `Problemas comunes:\n${wf.commonIssues}\n`;
    }
    if (wf.notes) {
      prompt += `Notas: ${wf.notes}\n`;
    }
    prompt += '\n---\n\n';
  });
  prompt += `# Como responder
1. Identifica el workflow relevante por nombre o contexto
2. Si es troubleshooting, da solucion paso a paso
3. Si es diseno/logica, analiza pros y contras
4. Si no tienes info suficiente, pide mas detalles
5. Si la pregunta esta fuera del scope, ayuda con conocimiento general pero aclaralo`;
  return prompt;
}

function createWorkflow(id, { description, systemPrompt, commonIssues, notes }) {
  const wfDir = path.join(WORKFLOWS_DIR, id);
  fs.mkdirSync(wfDir, { recursive: true });
  fs.mkdirSync(path.join(wfDir, 'screenshots'), { recursive: true });
  if (description) fs.writeFileSync(path.join(wfDir, 'description.txt'), description);
  if (systemPrompt) fs.writeFileSync(path.join(wfDir, 'system-prompt.txt'), systemPrompt);
  if (commonIssues) fs.writeFileSync(path.join(wfDir, 'common-issues.txt'), commonIssues);
  if (notes) fs.writeFileSync(path.join(wfDir, 'notes.txt'), notes);
  return { id, success: true };
}

module.exports = { buildSystemPrompt, loadAllWorkflows, createWorkflow, WORKFLOWS_DIR };
