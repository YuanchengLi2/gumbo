/** Chromium's hardware VP9 decoder fails on frames of an odd size ("Decoding error.", tested October 24 2026; VP8, H.264
 * and even sizes decode). Chrome's own screen recordings are VP9 WebM at the window's size, often odd (a friend's was
 * 391x577): its thumbnail and preview copy failed and it played from the raw recording, stuttering. Such a stream is sent
 * to the software decoder, which plays it. Imported, for its effect, by every page and worker that decodes video. */
const odd=(n:number|undefined)=>(n??0)%2===1;
const proto=(globalThis as {VideoDecoder?:typeof VideoDecoder}).VideoDecoder?.prototype as (VideoDecoder&{__gumboOdd?:boolean})|undefined;
if(proto&&!proto.__gumboOdd){
 const configure=proto.configure;
 proto.configure=function(this:VideoDecoder,config:VideoDecoderConfig){
  const software=/^(vp09|vp9|av01)/.test(config.codec)&&(odd(config.codedWidth)||odd(config.codedHeight))&&config.hardwareAcceleration!=='prefer-hardware';
  return configure.call(this,software?{...config,hardwareAcceleration:'prefer-software'}:config);
 };
 proto.__gumboOdd=true;
}
export {};
