// SPDX-License-Identifier: GPL-2.0-or-later
#include <FL/Fl.H>
#include <FL/Fl_Button.H>
#include <FL/Fl_Double_Window.H>
#include <FL/Fl_File_Chooser.H>
#include <FL/Fl_Input.H>
#include <FL/Fl_Multiline_Input.H>
#include <FL/Fl_Text_Display.H>
#include <nlohmann/json.hpp>
#include <iostream>
#include <iterator>
#include "appearance.h"
using Json = nlohmann::json;
int main() try {
    const auto request = Json::parse(std::string(std::istreambuf_iterator<char>(std::cin), {}));
    dx::init();
    const auto title = request.value("title", "Connected device");
    const auto kind = request.value("kind", "message");
    Json response = Json::object();
    if (kind == "file") {
        Fl_File_Chooser chooser(".", "*", Fl_File_Chooser::SINGLE, title.c_str());
        chooser.show();
        while (chooser.shown()) Fl::wait();
        if (chooser.value()) response["value"] = chooser.value();
    } else {
        Fl_Double_Window window(620, 420, title.c_str());
        Fl_Text_Buffer buffer;
        Fl_Text_Display transcript(12, 12, 596, 240);
        transcript.buffer(buffer);
        const auto text = request.value("text", "");
        buffer.text(text.c_str());
        Fl_Input number(90, 266, 518, 28, "Recipient:");
        Fl_Multiline_Input message(12, 306, 596, 60);
        message.value(request.value("message", "").c_str());
        if (kind != "sms") number.hide();
        if (kind == "message") message.hide();
        Fl_Button cancel(392, 382, 104, 28, "Cancel");
        Fl_Button accept(504, 382, 104, 28, kind == "sms" ? "Send" : "OK");
        window.end();
        window.resizable(transcript);
        dx::style(&window);
        bool accepted = false;
        accept.user_data(&accepted);
        accept.callback([](Fl_Widget *w, void *data) {
            *static_cast<bool *>(data) = true;
            w->window()->hide();
        }, &accepted);
        cancel.callback([](Fl_Widget *w, void *) { w->window()->hide(); });
        window.show();
        while (window.shown()) Fl::wait();
        if (accepted) {
            response["value"] = message.value();
            response["number"] = number.value();
            response["message"] = message.value();
        }
        transcript.buffer(nullptr);
    }
    std::cout << response.dump() << '\n';
    return 0;
} catch (const std::exception &error) {
    std::cerr << error.what() << '\n';
    return 1;
}
