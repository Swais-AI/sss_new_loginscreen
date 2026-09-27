// lib/nimbus-sms.js

export async function sendOtpSms(phoneNumber, otp) {
  const userId = process.env.NIMBUS_USER_ID?.trim();
  const password = process.env.NIMBUS_PASSWORD?.trim();
  const senderId = process.env.NIMBUS_SENDER_ID?.trim();
  const entityId = process.env.NIMBUS_ENTITY_ID?.trim();
  const templateId = process.env.NIMBUS_TEMPLATE_ID?.trim();

  // 1. Guardrail: Ensure credentials are actually loaded
  if (!userId || !password) {
    console.error("❌ Nimbus credentials missing! Check your .env file and restart the server.");
    return { success: false, error: "Missing Credentials in Environment" };
  }

  // 2. Force the '91' country code (Nimbus requires this for Indian numbers)
  let cleanPhone = phoneNumber.replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = `91${cleanPhone}`;
  }

  // 3. Exact DLT Template Message
  const message = `Your mobile verification OTP is ${otp} for SSS School . It is valid for 10 minutes. Do not share this OTP with anyone.\n- SARAF WORLDSPHERE AI SERVICES`;

  // 4. Use native URLSearchParams for foolproof character encoding (handles * and \n perfectly)
  const url = new URL("http://nimbusit.biz/api/SmsApi/SendSingleApi");
  url.searchParams.append("UserID", userId);
  url.searchParams.append("Password", password); 
  url.searchParams.append("SenderID", senderId);
  url.searchParams.append("Phno", cleanPhone);
  url.searchParams.append("Msg", message);
  url.searchParams.append("EntityID", entityId);
  url.searchParams.append("TemplateID", templateId);

  // CRITICAL: DLT scrubbers sometimes reject '+' for spaces. We force '%20' for web-safe spaces.
  const finalUrl = url.toString().replace(/\+/g, '%20');

  try {
    const response = await fetch(finalUrl, { 
      method: "GET",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" }
    });
    
    const data = await response.text();
    
    // Log the masked URL and exact response to your VS Code terminal
    console.log("📡 Outgoing SMS URL:", finalUrl.replace(password, '********'));
    console.log(`📡 Nimbus API Response [Status: ${response.status}]:`, data);

    // Catch hidden Nimbus errors (they often return 200 OK but put 'ERR' in the text)
    if (data.toLowerCase().includes("err") || data.toLowerCase().includes("invalid")) {
      return { success: false, error: data };
    }

    return { success: response.ok, data };
  } catch (error) {
    console.error("❌ Failed to send OTP fetch request:", error);
    return { success: false, error: error.message };
  }
}