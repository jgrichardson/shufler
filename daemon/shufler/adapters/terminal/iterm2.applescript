-- Shufler's bridge to iTerm2 (run by osascript; see iterm2.py).
--   list                     one line per session, fields separated by US (character id 31):
--                            window id, window name, tab number, tab title, pane number, session id,
--                            session name, tty, path variable, selected (true/false)
--   surface <session id>     prints the id when that session exists (empty otherwise)
--   focus <session id>       brings its window, tab and pane forward
--   write <session id> <t>   types t without a newline
--   key <session id> <code>  types one character by code point (13 = Return)
--   read <session id> <n>    the last n lines of the visible screen, trailing blank lines dropped
--   open <session id>        new tab in that session's window, cd to its path; prints the new session id
--   ping                     prints the number of windows (checks the Automation permission)
on run argv
	set cmd to item 1 of argv
	if cmd is "list" then return my listAll()
	if cmd is "ping" then
		tell application "iTerm2" to return (count of windows) as text
	end if
	set sid to item 2 of argv
	set loc to my findSession(sid)
	if loc is missing value then
		if cmd is "surface" then return ""
		error "no iTerm2 session " & sid number 1
	end if
	set {w, t, s} to loc
	tell application "iTerm2"
		if cmd is "surface" then
			return id of s
		else if cmd is "focus" then
			select w
			tell t to select
			tell s to select
			activate
			return "focused " & sid
		else if cmd is "write" then
			tell s to write text (item 3 of argv) newline no
			return ""
		else if cmd is "key" then
			tell s to write text (character id ((item 3 of argv) as integer)) newline no
			return ""
		else if cmd is "read" then
			set n to (item 3 of argv) as integer
			set c to (contents of s) as text
			set ps to my lines_(c)
			set last_ to count of ps
			repeat while last_ > 0
				if not my blank_(item last_ of ps) then exit repeat
				set last_ to last_ - 1
			end repeat
			set first_ to last_ - n + 1
			if first_ < 1 then set first_ to 1
			set out to ""
			repeat with i from first_ to last_
				set out to out & (item i of ps) & linefeed
			end repeat
			return out
		else if cmd is "open" then
			set p to ""
			try
				tell s to set p to (variable named "path")
			end try
			if p is missing value then set p to ""
			tell w to set nt to (create tab with default profile)
			set ns to current session of nt
			if p is not "" then tell ns to write text "cd " & quoted form of p
			return id of ns
		end if
	end tell
	error "unknown command " & cmd number 2
end run

on blank_(x)
	repeat with ch in (characters of x)
		if (ch as text) is not " " and (ch as text) is not tab then return false
	end repeat
	return true
end blank_

on lines_(c)
	return paragraphs of c
end lines_

on findSession(sid)
	tell application "iTerm2"
		repeat with w in windows
			repeat with t in tabs of w
				repeat with s in sessions of t
					if (id of s) is sid then return {w, t, s}
				end repeat
			end repeat
		end repeat
	end tell
	return missing value
end findSession

on listAll()
	set US to character id 31
	set out to ""
	tell application "iTerm2"
		set cw to -1
		try
			set cw to id of current window
		end try
		repeat with w in windows
			set wid to id of w
			set wname to ""
			try
				set wname to name of w
			end try
			set cur to ""
			try
				set cur to id of current session of w
			end try
			set tix to 0
			repeat with t in tabs of w
				set tix to tix + 1
				set ttitle to ""
				try
					set ttitle to title of t
				end try
				set pix to 0
				repeat with s in sessions of t
					set pix to pix + 1
					set p to ""
					try
						tell s to set p to (variable named "path")
					end try
					if p is missing value then set p to ""
					set sid to id of s
					set sel to (wid = cw) and (sid = cur)
					set out to out & wid & US & wname & US & tix & US & ttitle & US & pix & US & sid & US & (name of s) & US & (tty of s) & US & p & US & sel & linefeed
				end repeat
			end repeat
		end repeat
	end tell
	return out
end listAll
