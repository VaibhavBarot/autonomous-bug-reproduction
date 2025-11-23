import { Page } from 'playwright';
import { DOMElement } from './types';

export async function extractSimplifiedDOM(page: Page): Promise<DOMElement[]> {
  try {
    const elements = await page.evaluate(`
      (() => {
        const result = [];
        
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
        
        allElements.forEach((el) => {
          const element = el;
          
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return;
          }

          const text = (element.textContent || '').trim() || element.getAttribute('aria-label') || element.getAttribute('title') || '';
          const role = element.getAttribute('role') || element.tagName.toLowerCase();
          
          const getXPath = (node) => {
            if (node.nodeType === Node.DOCUMENT_NODE) {
              return '/';
            }
            const parts = [];
            let current = node;
            while (current && current.nodeType === Node.ELEMENT_NODE) {
              const elem = current;
              let index = 1;
              let sibling = elem.previousElementSibling;
              while (sibling) {
                if (sibling.nodeName === elem.nodeName) {
                  index++;
                }
                sibling = sibling.previousElementSibling;
              }
              const tagName = elem.nodeName.toLowerCase();
              parts.unshift(tagName + '[' + index + ']');
              current = elem.parentNode;
            }
            return '/' + parts.join('/');
          };
          
          const xpath = getXPath(element);
          
          const clickable = ['button', 'a', 'input[type="button"]', 'input[type="submit"]', '[role="button"]'].some(
            (sel) => element.matches(sel)
          ) || element.onclick !== null || element.getAttribute('tabindex') === '0';
          
          let selector = '';
          const id = element.id;
          const className = element.className;
          
          if (id) {
            selector = '#' + id;
          } else if (className && typeof className === 'string') {
            const classes = className.split(' ').filter((c) => c).slice(0, 2).join('.');
            if (classes) {
              selector = element.tagName.toLowerCase() + '.' + classes;
            }
          }
          
          if (!selector) {
            selector = element.tagName.toLowerCase();
          }
          
          if (text && text.length < 50) {
            const textSelector = 'text=\"' + text + '\"';
            if (clickable && text) {
              selector = textSelector;
            } else if (selector) {
              selector = selector + ' or ' + textSelector;
            } else {
              selector = textSelector;
            }
          }
          
          result.push({
            text: text,
            role: role,
            xpath: xpath,
            clickable: clickable,
            selector: selector,
            tagName: element.tagName.toLowerCase()
          });
        });
        
        return result;
      })()
    `);

    const seen = new Set<string>();
    return (elements as any[]).filter((el: any) => {
      const key = `${el.xpath}-${el.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return (el.text && el.text.length > 0) || el.clickable;
    }) as DOMElement[];
  } catch (error) {
    console.error('[DOM] Failed to extract simplified DOM:', error);
    return [];
  }
}

