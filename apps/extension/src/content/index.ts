/// <reference types="chrome" />
/** The content script, in every frame: finds fields, reads what they are for, shows Tab's ghost and Ctrl+K's card,
 * inserts text so it sticks, captures what memory keeps, and runs actions. Built up in src/content/*. */
import {start} from './engine';
start(window);
