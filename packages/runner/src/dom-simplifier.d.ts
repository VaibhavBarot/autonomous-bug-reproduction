import { Page } from 'playwright';
import { DOMElement } from './types';
export declare function extractSimplifiedDOM(page: Page): Promise<DOMElement[]>;
