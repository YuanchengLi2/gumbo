// Gumbo's listening tap: the audio a page is playing, mixed to mono at the context's rate (16 kHz), handed out a second
// at a time. It changes nothing in what plays.
class GumboPcm extends AudioWorkletProcessor{
 constructor(){super();this.buffer=new Float32Array(sampleRate);this.length=0;}
 process(inputs){
  const input=inputs[0];
  if(input&&input.length){
   const frames=input[0].length;
   for(let i=0;i<frames;i++){let sum=0;for(const channel of input)sum+=channel[i];this.buffer[this.length++]=sum/input.length;
    if(this.length===this.buffer.length){this.port.postMessage(this.buffer,[this.buffer.buffer]);this.buffer=new Float32Array(sampleRate);this.length=0;}}
  }
  return true;
 }
}
registerProcessor('gumbo-pcm',GumboPcm);
