import {
  APP_ROOT,
  BASE_URL,
  IMAGE_BASE_URL,
  RESOURCE_ROOT,
  absoluteUrl,
  downloadFile,
  fetchJson,
  fetchText,
} from "../radiopaedia-client.mjs";

export const radiopaediaProvider = {
  id: "radiopaedia",
  label: "Radiopaedia",
  baseUrl: BASE_URL,
  imageBaseUrl: IMAGE_BASE_URL,
  appRoot: APP_ROOT,
  resourceRoot: RESOURCE_ROOT,
  absoluteUrl,
  fetchJson,
  fetchText,
  downloadFile,
};

export {
  APP_ROOT,
  BASE_URL,
  IMAGE_BASE_URL,
  RESOURCE_ROOT,
  absoluteUrl,
  downloadFile,
  fetchJson,
  fetchText,
};
