// TUBULAR-9000 - an ad-free, tracker-free and almost serverless video feed reader
// (c) 2020 Bertrand Le Roy

// Uncomment during development to start from an empty local cache:
clearLocalStore();

// Settings

const settings = {
  // URL of the subscriptions OPML file:
  subscriptions: "subscriptions"
};

// Local data

let subscriptions = [];
let selectedSubscription = "*";

// Class definitions

/**
 * A subscription
 */
class Subscription {
  constructor(options) {
    this.title = options.title;
    this.url = options.url;
    this.icon = options.icon || "./favicon-32x32.png";
    this.detailsFetched = !!options.detailsFetched;
    this.postings = [];
    this.hwm = new Date(0);
  }

  /**
   * Adds a posting to the subscription
   * @param {Posting} posting The posting to add to the subscription
   */
  addPosting(posting) {
    if (!posting.id) {
      console.error(`Can't add a posting without an id: {posting}`);
      return;
    }
    const index = this.postings.findIndex(p => p.id === posting.id);
    if (index !== -1) {
      this.postings[index] = posting;
    }
    else {
      const insertIndex = this.postings.findIndex(p => posting.published > p.published);
      if (insertIndex === -1)
      {
        this.postings.push(posting);
      }
      else {
        this.postings.splice(insertIndex, 0, posting);
      }
    }
  }
}

/**
 * The subscription that has all the postings from all subscriptions
 */
class MetaSubscription extends Subscription {
  constructor(options) {
    super(options);
    this.postingsElements = options.postingsElements || [];
  }

  /**
   * Adds a posting to the subscription
   * @param {Posting} posting The posting to add to the subscription
   */
  addPosting(posting) {
    if (!posting.id) {
      console.error(`Can't add a posting without an id: {posting}`);
      return;
    }
    const index = this.postings.findIndex(p => p.id === posting.id);
    if (index !== -1) {
      (this.postings[index].elements || []).forEach(el => {
        render(posting, {
          usingTemplate: el.template,
          replacing: el.element
        });
      });
      this.postings[index] = posting;
    }
    else {
      const insertIndex = this.postings.findIndex(p => posting.published > p.published);
      if (insertIndex === -1)
      {
        this.postingsElements.forEach(el => {
          render(posting, {
            usingTemplate: el.template,
            atStartOf: el.element
          });
        });
        this.postings.push(posting);
      }
      else {
        (this.postings[insertIndex].elements || []).forEach(el => {
          render(posting, {
            usingTemplate: el.template,
            before: el.element
          });
        });
        this.postings.splice(insertIndex, 0, posting);
      }
    }
  }
}

const metaSubscription = new MetaSubscription({
  title: "All subscriptions"
});

/**
 * A posting
 */
class Posting {
  constructor(options) {
    this.id = options.id;
    this.title = options.title || "[untitled]";
    this.url = options.url;
    this.media = options.media;
    this.thumbnail = options.thumbnail;
    this.published = options.published;
    this.updated = options.updated;
    this.description = options.description || "";
    this.starRating = options.starRating || 0;
    this.views = options.views || 0;
  }
}

// Network

const domParser = new DOMParser();

/**
 * @callback xmlRequestCallback
 * @param {Document} document The document
 */

/**
 * Loads an XML resource from the network.
 * @param {string} url The URL of the resource to fetch
 * @param {string} mimeType The mimetype to use to parse the document. Default is "application/xml".
 * @param {Subscription} subscription an optional subscription used to give more context in case of a failure.
 */
async function loadDocument(url, mimeType, subscription) {
  const response = await fetch(new Request(url));
  if (!response.ok) {
    throw new Error(subscription ?
      `HTTP error downloading ${subscription.title}! status: ${response.status}` :
      `HTTP error downloading ${url}! status: ${response.status}`);
  }
  const xml = await response.text();
  const doc = domParser.parseFromString(xml, mimeType || "application/xml");
  return doc;
}

// Templating

const interpolationCache = {};

/**
 * Dynamically interpolates a string using the provided data.
 * @param {string} format The format string in the string interpolation format
 * @param {object} params The dictionary of available data to use when interpolating
 */
function interpolate(format, params) {
  const names = Object.keys(params);
  const values = Object.values(params);
  const key = `${format}(${names.join(",")})`;
  if (interpolationCache[key]) {
    return interpolationCache[key](...values);
  }
  return (interpolationCache[key] = new Function(...names, `return \`${format}\`;`))(...values);
}

/**
 * Evaluates an expression
 * @param {string} expression The expression to evaluate
 * @param {object} params The dictionary of available data to evaluate against
 * @return {*} the result of evaluating the expression
 */
function evaluate(expression, params) {
  const names = Object.keys(params);
  const values = Object.values(params);
  const key = `expr:${expression}(${names})`;
  if (interpolationCache[key]) {
    return interpolationCache[key](...values);
  }
  return (interpolationCache[key] = new Function(...names, `return ${expression};`))(...values);
}

/**
 * Binds attributes, text elements and child elements to the provided data.
 * @param {Element} template The template to bind
 * @param {object} data The dictionary of data available to binding expressions
 * @returns {Array<Element>} The rendered element or elements
 */
function bind(template, data) {
  // Clone the template
  const clonedTemplate = template.cloneNode(true);
  // If the template is parented, un-parent it
  if (template.parentNode) {
    template.parentNode.removeChild(template);
  }
  // Make "self" a property of the data object pointing to itself
  if (typeof(data) === "object") {
    data.self = data;
  }
  else {
    data = {self: data};
  }
  // Check for loop
  if (clonedTemplate.hasAttribute("data-foreach")) {
    const foreachExpression = clonedTemplate.getAttribute("data-foreach");
    const forEachArray = evaluate(foreachExpression, data);
    if (!Array.isArray(forEachArray)) {
      throw new Error(`Expression \`${foreachExpression}\` didn't evaluate to an array.`);
    }
    return forEachArray.flatMap(item => {
      const loopedEl = clonedTemplate.cloneNode(true);
      loopedEl.removeAttribute("data-foreach");
      return bind(loopedEl, item)
    })
  }
  // Check for conditional rendering
  if (clonedTemplate.hasAttribute("data-if")) {
    if (!evaluate(clonedTemplate.getAttribute("data-if"), data)) {
      return [];
    }
    //clonedTemplate.removeAttribute("data-if");
  }
  // Clone the template again for rendering
  const el = clonedTemplate.cloneNode(true);
  // Remove id from the cloned element
  if (el.hasAttribute("id")) {
    el.removeAttribute("id");
  }
  // Bind all attributes and rename them if they're data attributes
  [...el.attributes].forEach(attr => {
    const isDataAttribute = attr.name.substring(0, 5) === "data-";
    const attrName = isDataAttribute ? attr.name.substring(5) : attr.name;
    el.setAttribute(attrName, interpolate(attr.nodeValue, data));
    if (isDataAttribute) {
      el.removeAttribute(attr.name);
    }
  });
  // Bind child elements and text nodes
  [...el.childNodes].forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      child.nodeValue = interpolate(child.nodeValue, data);
    }
    else if (child.nodeType === Node.ELEMENT_NODE) {
      el.append(...bind(child, data));
    }
  });
  // Remember that this element was bound to that piece of data, for future updates
  (data.elements || (data.elements = [])).push({element: el, template: clonedTemplate});
  return [el];
}

/**
 * Renders data using a template.
 * @param {object} data The data to render
 * @param {{ usingTemplate: Element, atEndOf: Element, atStartOf: Element, replacing: Element, after: Element, before: Element }} options The template to use and where to render it
 */
function render(data, options) {
  const elements = bind(options.usingTemplate, data);
  if (elements) {
    if (options.atEndOf) {
      const container = options.atEndOf;
      container.append(...elements);
    }
    if (options.atStartOf) {
      const container = options.atStartOf;
      container.prepend(...elements);
    }
    if (options.replacing) {
      if (elements.length !== 1) {
        console.warn("Template failed to render as a single element for use with 'replacing'.");
        return;
      }
      const container = options.replacing.parentNode;
      container.replaceChild(elements[0], options.replacing);
    }
    if (options.after) {
      options.after.after(elements[0]);
    }
    if (options.before) {
      options.before.before(elements[0]);
    }
  }
}

/**
 * Updates the rendered elements for this data.
 * @param {object} data The data to re-render
 */
function updateRendering(data) {
  if (data.elements) {
    data.elements.forEach(el => {
      const index = data.elements.indexOf(el);
      if (index === -1) return;
      data.elements.splice(index, 1);
      render(data, {usingTemplate: el.template, replacing: el.element});
    });
  }
}

// Model mapping

/**
 * @callback mapping Transforms an object into another
 * @param {object} obj The object to map
 * @returns {object} The mapped object 
 */

/**
 * Maps an object from one model to another
 * @param {object} obj The object to map
 * @param {mapping} mapping The function doing the mapping
 */
function mapModel(obj, mapping) {
  return mapping(obj);
}

// Local storage

/**
 * Clears local storage, mostly during development
 */
function clearLocalStore() {
  localStorage.clear();
}

/**
 * Stores a value
 * @param {string} name the name of the value to store
 * @param {*} value the value to store
 */
function localStore(name, value) {
  localStorage.setItem(name, value);
}

/**
 * @callback getValueCallback
 * @returns {*} the value
 */

/**
 * Fetches a value from local storage, or restores it using the provided callback
 * @param {string} name the name of the value to fetch
 * @param {getValueCallback} fallback an async function that can generate the value if the cache lookup misses
 */
async function localFetch(name, fallback) {
  const result = localStorage.getItem(name) || await fallback();
  localStore(name, result);
  return result;
}

// Application features

/** Refreshes the data about a subscription
 * @param {Subscription} sub The subscription structure
 */
async function refreshSubscription(sub) {
  if (sub.url.substring(0, 8) === "https://") {
    //console.log(`Fetching ${sub.title} from ${sub.url}...`);
    const subDoc = await loadDocument(`feed/${sub.url.substring(8)}`, null, sub);
    const subFeed = [...subDoc.querySelectorAll('feed entry')]
      .map(entry => new Posting({
        id: entry.querySelector("id").textContent,
        title: entry.querySelector("title").textContent,
        url: entry.querySelector('link[rel="alternate"]').getAttribute("href"),
        media: mapModel(
          entry.querySelector("group content[url]"),
          m => ({
            url: m.getAttribute("url"),
            width: m.getAttribute("width"),
            height: m.getAttribute("height")
          })),
        thumbnail: mapModel(
          entry.querySelector("group thumbnail[url]"),
          m => ({
            url: m.getAttribute("url"),
            width: m.getAttribute("width"),
            height: m.getAttribute("height")
          })),
        published: new Date(entry.querySelector("published").textContent),
        updated: new Date(entry.querySelector("updated").textContent),
        description: entry.querySelector("group description").textContent,
        starRating: parseFloat(entry.querySelector("community starRating").getAttribute("average")),
        views: parseInt(entry.querySelector("community statistics[views]").getAttribute("views"))
      }));
    subFeed.forEach(posting => {
      sub.addPosting(posting);
      metaSubscription.addPosting(posting);
    });
    const feedPageUrl = subDoc.querySelector('feed link[rel="alternate"]').getAttribute("href");
    const iconUrl = await getIconFromFeedPage(feedPageUrl);
    if (iconUrl) {
      sub.icon = iconUrl;
      updateRendering(sub);
    }
  }
  else {
    console.warn(`${sub.title} is not using https. Skipping.`);
  }
}

/**
 * Scrapes the subscription's icon URL from its page
 * @param {string} url The URL from which to scrape the icon URL
 */
async function getIconFromFeedPage(url) {
  if (url.substring(0, 8) === "https://") {
    // console.log(`Fetching ${url}...`);
    const subDoc = await loadDocument(`feed/${url.substring(8)}`, "text/html");
    const iconUrl = subDoc.querySelector('link[rel="image_src"]').getAttribute("href");
    // console.log(`Found icon URL ${iconUrl}`);
    return iconUrl;
  }
  else {
    console.warn(`${sub.title} is not using https. Skipping.`);
  }
}

// Application startup

document.addEventListener("DOMContentLoaded", async () => {
  // DOM elements

  const subscriptionsSection = document.getElementById("subscriptions");
  const subscriptionTemplate = document.getElementById("subscription-template");
  const postingsSection = document.getElementById("postings");
  const postingTemplate = document.getElementById("posting-template");

  // Set-up the meta subscription to render the feed
  metaSubscription.postingsElements = [{element: postingsSection, template: postingTemplate}];

  // Load subscriptions
  subscriptions = await localFetch(
    "subscriptions",
    async () => [
      ...(await loadDocument(settings.subscriptions))
      .firstElementChild
      .firstElementChild
      .firstElementChild
      .children
    ].map(node => new Subscription({
      title: node.attributes.title.nodeValue,
      url: node.attributes.xmlUrl.nodeValue
    })));
  subscriptionsSection.innerHTML = "";
  subscriptions
    .sort((sub1, sub2) => sub1.title > sub2.title ? 1 : sub1.title < sub2.title ? -1 : 0)
    .forEach(async sub => {
      render(sub, {
        atEndOf: subscriptionsSection,
        usingTemplate: subscriptionTemplate
      });
      await refreshSubscription(sub);
    });

  // Wire refresh button
  document.getElementById("refresh-button").addEventListener("click", () => {
    subscriptions.forEach(sub => refreshSubscription(sub));
  });
});
