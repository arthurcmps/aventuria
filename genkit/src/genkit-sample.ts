// Import the Genkit core libraries and plugins.
import {genkit} from "genkit";
import {googleAI} from "@genkit-ai/googleai";

// Import models from the Google AI plugin. The Google AI API provides access to
// several generative models.

// Cloud Functions for Firebase supports Genkit natively. The onCallGenkit
// function creates a callable function from a Genkit action. It automatically
// implements streaming if your flow does. The https library also has other
// utility methods such as hasClaim, which verifies that a caller's token
// has a specific claim (optionally matching a specific value)

// Genkit models generally depend on an API key. APIs should be stored in
// Cloud Secret Manager so that access to these sensitive values can be
// controlled. defineSecret does this for you automatically. If you are using
// Google generative AI you can get an API key at
// https://aistudio.google.com/app/apikey
import {defineSecret} from "firebase-functions/params";
const apiKey = defineSecret("GOOGLE_GENAI_API_KEY");

// The Firebase telemetry plugin exports a combination of metrics, traces, and
// logs to Google Cloud Observability.
// See https://firebase.google.com/docs/genkit/observability/telemetry-collection.
import {enableFirebaseTelemetry} from "@genkit-ai/firebase";
enableFirebaseTelemetry();

genkit({
  plugins: [
    // Load the Google AI plugin. You can optionally specify your API key
    // by passing in a config object; if you don't, the Google AI plugin uses
    // the value from the GOOGLE_GENAI_API_KEY environment variable, which is
    // the recommended practice.
    googleAI({apiKey: apiKey.value()}),
  ],
});
