const MESSAGES: Record<number, string> = {
  1: 'SmartSpectra is in an unexpected state. Start the sensor again.',
  2: 'The API key was rejected. Check SMARTSPECTRA_API_KEY on the consent screen.',
  3: 'SmartSpectra could not configure its pipeline. Try a different input.',
  4: 'This API key is out of credits.',
  5: 'The Presage service could not be reached. Check the network and try again.',
  6: 'The Presage service returned an error. This usually clears on a retry.',
  7: 'The camera gave no usable frames. Reopen the camera or pick another input.',
  8: 'The sensor lost the signal. Keep your face in frame and hold still.',
  9: 'A frame could not be converted. Restart the sensor.',
  10: 'Frame timing went backwards. SmartSpectra recovers on its own.',
  11: 'Frames arrived too far apart. Keep the camera on a steady connection.',
}

export function describeSdkError(code: number): string {
  return MESSAGES[code] ?? 'SmartSpectra stopped processing. Restart the sensor to try again.'
}
