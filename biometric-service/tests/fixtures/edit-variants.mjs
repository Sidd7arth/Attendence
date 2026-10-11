import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const SRC = '/tmp/biofixtures/identity_a1.png';
const OUT = '/home/z/my-project/biometric-service/tests/fixtures';

async function edit(prompt, outputPath) {
  const zai = await ZAI.create();
  const b64 = fs.readFileSync(SRC).toString('base64');
  const dataUrl = `data:image/png;base64,${b64}`;
  let response;
  try {
    // image edit API when available
    response = await zai.images.edits.create({ prompt, image: dataUrl, size: '864x1152' });
  } catch {
    response = await zai.images.generations.create({ prompt, image: dataUrl, size: '864x1152' });
  }
  const out = response.data[0].base64;
  fs.writeFileSync(outputPath, Buffer.from(out, 'base64'));
  console.log('saved', outputPath);
}

const jobs = [
  ['Keep the exact same person, face and identity unchanged. Slightly tilted head (5 degrees), dimmer warm indoor lighting, webcam-style head-and-shoulders portrait.', `${OUT}/identity_a2.png`],
  ['Keep the exact same person, face and identity unchanged. Neutral expression with mouth closed, brighter cool daylight from a window, webcam-style head-and-shoulders portrait.', `${OUT}/identity_a3.png`],
  ['Keep the exact same person, face and identity unchanged. Head turned slightly to their right (10 degrees), soft evening lighting, webcam-style portrait.', `${OUT}/identity_a4.png`],
  ['Show this exact photo printed on white paper and photographed again with a phone camera: visible paper texture, slight moire pattern, small glare across the top corner, paper edges visible, slightly lower contrast like a photo of a photo.', `${OUT}/spoof_a_paper.png`],
];

for (const [prompt, out] of jobs) {
  await edit(prompt, out);
}
console.log('done');
