import {audioSetClasses} from './audioset';

/** The kinds of sound an editor looks for, each a set of YAMNet's AudioSet classes, and how sure the classifier must be
 * (its scores are per class, from 0 to 1) before a stretch counts. Speech and music decide what each stretch is; the
 * rest are events worth knowing about: a laugh, applause, a bang. */
export type SoundGroup='speech'|'music'|'singing'|'silence'|'laughter'|'applause'|'cheering'|'shouting'|'crying'|'impact'|'alarm'|'animal'|'vehicle'|'nature';
const members:Record<SoundGroup,string[]>={
 speech:['Speech','Child speech, kid speaking','Conversation','Narration, monologue','Speech synthesizer','Whispering','Babbling'],
 music:['Music','Musical instrument','Video game music','Background music','Theme music','Soundtrack music'],
 singing:['Singing','Choir','Child singing','Synthetic singing','Rapping','Chant','Humming','Yodeling'],
 silence:['Silence'],
 laughter:['Laughter','Baby laughter','Giggle','Snicker','Belly laugh','Chuckle, chortle'],
 applause:['Applause','Clapping'],
 cheering:['Cheering','Crowd','Whoop','Children shouting'],
 shouting:['Shout','Yell','Screaming','Bellow'],
 crying:['Crying, sobbing','Baby cry, infant cry','Wail, moan','Whimper'],
 impact:['Explosion','Gunshot, gunfire','Machine gun','Fusillade','Artillery fire','Cap gun','Fireworks','Firecracker','Burst, pop','Boom','Bang','Smash, crash','Breaking','Thump, thud','Slam','Shatter'],
 alarm:['Alarm','Siren','Civil defense siren','Police car (siren)','Ambulance (siren)','Fire engine, fire truck (siren)','Car alarm','Smoke detector, smoke alarm','Fire alarm','Alarm clock','Buzzer','Beep, bleep','Bell','Doorbell','Telephone bell ringing','Ringtone'],
 animal:['Dog','Bark','Cat','Meow','Bird','Bird vocalization, bird call, bird song','Horse','Livestock, farm animals, working animals','Roaring cats (lions, tigers)'],
 vehicle:['Vehicle','Car','Motor vehicle (road)','Motorcycle','Truck','Bus','Train','Aircraft','Helicopter','Engine','Race car, auto racing','Car passing by','Traffic noise, roadway noise','Boat, Water vehicle','Vehicle horn, car horn, honking'],
 nature:['Wind','Rain','Water','Stream','Ocean','Waves, surf','Thunderstorm','Thunder','Waterfall','Fire'],
};
export const soundGroups=Object.keys(members) as SoundGroup[];
/** Each group's class indices in YAMNet's output. A name the class map does not have is an error in this table. */
export const groupClasses:Record<SoundGroup,number[]>=Object.fromEntries(soundGroups.map(g=>[g,members[g].map(name=>{const i=audioSetClasses.indexOf(name);if(i<0)throw new Error(`No AudioSet class "${name}"`);return i;})])) as Record<SoundGroup,number[]>;
/** How sure the classifier must be for an event to count. Laughter and applause score low even when clear. */
export const eventThreshold:Partial<Record<SoundGroup,number>>={laughter:.2,applause:.25,cheering:.3,shouting:.3,crying:.3,impact:.25,alarm:.35,animal:.35,vehicle:.4,nature:.4,singing:.35};
export const eventGroups=Object.keys(eventThreshold) as SoundGroup[];
/** Words for a group in sound.txt. */
export const groupWords:Record<SoundGroup,string>={speech:'speech',music:'music',singing:'singing',silence:'silence',laughter:'laughter',applause:'applause',cheering:'cheering or crowd',shouting:'shouting or screaming',crying:'crying',impact:'bang or impact',alarm:'alarm, siren or bell',animal:'animal',vehicle:'vehicle or engine',nature:'wind, water or weather'};
