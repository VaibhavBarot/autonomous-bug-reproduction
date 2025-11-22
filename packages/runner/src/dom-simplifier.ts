import { Page } from 'playwright';
import { DOMElement } from './types';

export async function extractSimplifiedDOM(page: Page): Promise<DOMElement[]> {
  const elements = await page.evaluate(() => {
    const result: DOMElement[] = [];
    
    // Get all potentially clickable elements
    const selectors = [
      'button',
      'a',
      'input[type="button"]',
      'input[type="submit"]',
      '[role="button"]',
      '[onclick]',
      '[tabindex="0"]',
      'select',
      'textarea',
      'input[type="text"]',
      'input[type="email"]',
      'input[type="password"]',
      'input[type="search"]',
      '[contenteditable="true"]'
    ];

    const allElements = document.querySelectorAll(selectors.join(', '));
    
    allElements.forEach((el: Element) => {
      const element = el as HTMLElement;
      
      // Skip hidden elements
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return;
      }

      // Get text content
      const text = element.textContent?.trim() || element.getAttribute('aria-label') || element.getAttribute('title') || '';
      
      // Get role
      const role = element.getAttribute('role') || element.tagName.toLowerCase();
      
      // Generate xpath (simplified)
      const getXPath = (node: Node): string => {
        if (node.nodeType === Node.DOCUMENT_NODE) {
          return '/';
        }
        const parts: string[] = [];
        let current: Node | null = node;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
          const element = current as Element;
          let index = 1;
          let sibling = element.previousElementSibling;
          while (sibling) {
            if (sibling.nodeName === element.nodeName) {
              index++;
            }
            sibling = sibling.previousElementSibling;
          }
          const tagName = element.nodeName.toLowerCase();
          parts.unshift(`${tagName}[${index}]`);
          current = element.parentNode;
        }
        return '/' + parts.join('/');
      };
      
      const xpath = getXPath(element);
      
      // Determine if clickable
      const clickable = ['button', 'a', 'input[type="button"]', 'input[type="submit"]', '[role="button"]'].some(
        sel => element.matches(sel)
      ) || element.onclick !== null || element.getAttribute('tabindex') === '0';
      
      // Generate selector
      let selector = '';
      const id = element.id;
      const className = element.className;
      
      if (id) {
        selector = `#${id}`;
      } else if (className && typeof className === 'string') {
        const classes = className.split(' ').filter(c => c).slice(0, 2).join('.');
        if (classes) {
          selector = `${element.tagName.toLowerCase()}.${classes}`;
        }
      }
      
      if (!selector) {
        selector = element.tagName.toLowerCase();
      }
      
      // Add text-based selector option (use Playwright-friendly format)
      if (text && text.length < 50) {
        // Use Playwright's text selector format
        const textSelector = `text="${text}"`;
        // Prefer text selector for buttons with text
        if (clickable && text) {
          selector = textSelector;
        } else if (selector) {
          selector = `${selector} or ${textSelector}`;
        } else {
          selector = textSelector;
        }
      }
      
      result.push({
        text,
        role,
        xpath,
        clickable,
        selector,
        tagName: element.tagName.toLowerCase()
      });
    });
    
    return result;
  });
  
  // Deduplicate and filter
  const seen = new Set<string>();
  return elements.filter(el => {
    const key = `${el.xpath}-${el.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return el.text.length > 0 || el.clickable;
  });
}

