/** Sound analysis on the user's computer: what kind of sound is where, notable sounds, loud moments, who speaks when, and
 * music's tempo and beats. Pure TypeScript around two small ONNX models, the same on the web and the desktop. */
export {analyseSound,SOUND_ANALYSIS_VERSION,type SoundAnalysis,type SoundModels,type SoundSection,type SoundEvent,type SectionKind,type LoudMoment,type MusicSection} from './analyse';
export {loadSoundModels,soundModelFiles,type SoundModelFile,type LoadedSoundModels,type OnnxRuntime} from './runtime';
export {speakerAt,type SpeakerTurn} from './speakers';
export {groupWords,type SoundGroup} from './classes';
export {SAMPLE_RATE} from './fbank';
