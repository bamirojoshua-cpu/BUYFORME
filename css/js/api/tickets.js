import { supabase } from "../supabase.js";

export async function fetchMyTickets(userId) {
  const { data, error } = await supabase
    .from("support_tickets")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchAllTickets() {
  const { data, error } = await supabase
    .from("support_tickets")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createTicket({ userId, userName, userEmail, subject, body, priority = "normal" }) {
  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      user_id: userId,
      user_name: userName,
      user_email: userEmail,
      subject,
      body,
      priority,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTicketStatus(id, status, adminNotes = null) {
  const patch = { status, updated_at: new Date().toISOString() };
  if (adminNotes !== null) patch.admin_notes = adminNotes;
  const { error } = await supabase.from("support_tickets").update(patch).eq("id", id);
  if (error) throw error;
}
