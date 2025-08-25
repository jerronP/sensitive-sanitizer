/**
 * Utilities for executing Playwright actions, including shadow DOM traversal.
 */
export async function enterShadowChain(page, prerequisite) {
  let context = page;
  if (!prerequisite || prerequisite.length === 0) return context;

  for (const pre of prerequisite) {
    if (pre.action !== "switchToShadowRoot") continue;
    const target = pre.target;
    let hostHandle;

    if (context === page) {
      hostHandle = await page.$(target);
    } else {
      hostHandle = await context.evaluateHandle((root, selector) => {
        let found = root.querySelector(selector);
        if (found) return found;
        if (root.host && root.host.shadowRoot) {
          const slots = root.querySelectorAll("slot");
          for (const slot of slots) {
            const assigned = slot.assignedElements?.() || [];
            const match = assigned.find(el => el.matches(selector));
            if (match) return match;
          }
        }
        return null;
      }, target);
    }

    if (!hostHandle) continue;
    const shadowRoot = await hostHandle.evaluateHandle(n => n.shadowRoot || null);
    if (!shadowRoot) continue;
    context = shadowRoot;
  }
  return context;
}

export async function findInputInContext(context, targetStr) {
  let handle = await context.evaluateHandle(
    (root, t) =>
      root.querySelector(`input[placeholder="${t}"]`) ||
      root.querySelector(`textarea[placeholder="${t}"]`),
    targetStr
  );
  if (handle) return handle;

  handle = await context.evaluateHandle(
    (root, t) => root.querySelector(`input[name="${t}"], textarea[name="${t}"]`),
    targetStr
  );
  if (handle) return handle;

  handle = await context.evaluateHandle(
    (root, t) => root.querySelector(`#${CSS.escape(t)}`),
    targetStr
  );
  return handle;
}

export async function executeActions(page, actions) {
  for (const step of actions) {
    const { playwrightAction, prerequisite } = step;
    switch (playwrightAction.action) {
      case "goto":
        await page.goto(playwrightAction.url);
        break;
      case "input": {
        const context = await enterShadowChain(page, prerequisite ?? []);
        const elHandle = await findInputInContext(context, playwrightAction.target);
        if (!elHandle) throw new Error(`Input not found for target "${playwrightAction.target}"`);
        const el = elHandle.asElement();
        if (!el) throw new Error("Target is not an element.");
        await el.fill("");
        await el.type(playwrightAction.value);
        break;
      }
      default:
        throw new Error(`Action "${playwrightAction.action}" not implemented.`);
    }
  }
}