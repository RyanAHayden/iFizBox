# F465 notes

- Pairing under the name iFizBox replaces an installed iFizBox app's own pairing. Its Paired Devices list keeps one
  iFizBox row, but the app shows "Pairing Lost" until it re-pairs (Fix). A Phone Setup over an installed app breaks
  it unless the app takes the handed pairing (F465a).
- Open Minis's background Bonjour advertisement shows as "Pair with iFizBox" in Developer Mode while Minis is
  backgrounded; the code comes as a notification, so no Pairing page is needed on the phone.
- idevice's service type ends in ".local.", which a strict Bonjour check refuses.
