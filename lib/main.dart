import 'dart:io';

import 'package:Dig/reload.dart';
import 'package:Dig/settings.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:protocol_controller/gopher_controller.dart';
import 'package:protocol_parser/gopher_parser.dart';
import 'package:url_launcher/url_launcher.dart';

import 'download.dart';
import 'history.dart';
import 'home.dart';

void main() {
  runApp(DigBrowser());
}

class DigBrowser extends StatelessWidget {
  const DigBrowser({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Dig Browser',
      theme: ThemeData(
        primarySwatch: Colors.blue,
      ),
      home: DigHomePage(title: 'Dig Browser'),
    );
  }
}

class DigHomePage extends StatefulWidget {
  DigHomePage({Key? key, required this.title}) : super(key: key);
  final String title;

  @override
  _DigHomePageState createState() => _DigHomePageState();
}

class _DigHomePageState extends State<DigHomePage>
    with SingleTickerProviderStateMixin {
  final List<String> history = [];
  final List<String> downloadHistory = [];
  final List<TabData> tabData = [];

  late HomeWidget homeWidget;
  late SettingsWidget settingsWidget;
  late HistoryWidget historyWidget;
  late DownloadHistoryWidget downloadWidget;

  late TextEditingController _searchController;
  late TabController _tabController;

  bool isLoading = false;
  bool showAppBar = false;
  bool gotBack = false;
  bool getUp = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _tabController.addListener(_handleTabCountChanged);
    _searchController = TextEditingController();

    homeWidget = HomeWidget(
      onTabCountChanged: _handleTabCountChanged,
      tabs: tabData,
      searchFunction: _searchGopher,
      downloadFunction: _downloadGopher,
    );
    settingsWidget = SettingsWidget();
    historyWidget = HistoryWidget(
      historyItems: history,
      searchFunction: _searchGopher,
    );
    downloadWidget = DownloadHistoryWidget(downloadItems: downloadHistory);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _handleTabCountChanged() {
    bool isFirstTab = _tabController.index == 0;
    bool hasTabs = homeWidget.tabs.isNotEmpty;

    setState(() {
      showAppBar = isFirstTab && hasTabs;
    });
  }

  void goBack() {
    print("Back before " +
        "" +
        tabData[homeWidget.tabController.index].tabHistoryTop.toString() +
        "" +
        tabData[homeWidget.tabController.index].title +
        "" +
        tabData[homeWidget.tabController.index].tabHistoryBottom.toString() +
        "");
    setState(() {
      gotBack = true;
      String url =
          tabData[homeWidget.tabController.index].tabHistoryBottom.removeLast();
      tabData[homeWidget.tabController.index]
          .tabHistoryTop
          .insert(0, tabData[homeWidget.tabController.index].title);
      _searchGopher(url);
    });

    print("Back after" +
        "Top:" +
        tabData[homeWidget.tabController.index].tabHistoryTop.toString() +
        "" +
        tabData[homeWidget.tabController.index].title +
        "Bottom:" +
        tabData[homeWidget.tabController.index].tabHistoryBottom.toString() +
        "  " +
        (tabData[homeWidget.tabController.index].tabHistoryBottom.isEmpty
            ? "false"
            : "true"));
  }

  void goForward() {
    getUp = true;

    String url =
        tabData[homeWidget.tabController.index].tabHistoryTop.removeAt(0);
    tabData[homeWidget.tabController.index]
        .tabHistoryBottom
        .add(tabData[homeWidget.tabController.index].title);
    _searchGopher(url);
    print("Forward " +
        "" +
        tabData[homeWidget.tabController.index].tabHistoryTop.toString() +
        "" +
        tabData[homeWidget.tabController.index].title +
        "" +
        tabData[homeWidget.tabController.index].tabHistoryBottom.toString() +
        "");
  }

  void _startReloadAnimation() {
    setState(() {
      isLoading = true;
    });
  }

  void _stopReloadAnimation() {
    setState(() {
      isLoading = false;
    });
  }

  void _handleKeyEvent(RawKeyEvent event) {
    if (event is RawKeyDownEvent &&
        event.logicalKey == LogicalKeyboardKey.enter &&
        _searchController.text.isNotEmpty) {
      _searchGopher(_searchController.text);
      _searchController.clear();
    }
  }

  Future<String> _gopherRequest(Uri searchUrl) {
    GopherController initRequest = GopherController(
      searchUrl.host,
      searchUrl.hasPort ? searchUrl.port : 70,
      searchUrl.hasAbsolutePath ? searchUrl.path : "/",
      GopherController.NONE_SELECTOR,
    );

    return initRequest.make_request(searchUrl.query);
  }

  void _downloadGopher(String url) {
    _startReloadAnimation();
    String downloadsDirectory = "";
    if (Platform.isWindows) {
      downloadsDirectory = Platform.environment['USERPROFILE']!;
    } else if (Platform.isLinux || Platform.isMacOS) {
      downloadsDirectory = Platform.environment['HOME']!;
    } else if (Platform.isAndroid) {
      downloadsDirectory = Platform.environment['EXTERNAL_STORAGE']!;
    }
    Uri searchUrl =
        Uri.parse(url.contains("gopher://") ? url : "gopher://" + url);
    _gopherRequest(searchUrl).then((value) {
      File file = File(downloadsDirectory +
          Platform.pathSeparator +
          searchUrl.pathSegments.last);
      file.writeAsBytes(value.codeUnits);
      if (searchUrl.pathSegments.last.contains(".html")) {
        canLaunchUrl(file.uri).then((value) {
          if (value) {
            launchUrl(file.uri);
          }
        });
      }
      if (!downloadHistory.contains(searchUrl.pathSegments.last)) {
        downloadHistory.add(searchUrl.pathSegments.last);
      }
      _stopReloadAnimation();
    }).catchError((error) {
      _stopReloadAnimation();
    });
  }

  void _searchGopher(String url) {
    _startReloadAnimation();
    Uri searchUrl =
        Uri.parse(url.contains("gopher://") ? url : "gopher://" + url);
    _gopherRequest(searchUrl).then((value) {
      GopherParser parser = GopherParser(value);
      List<GopherElement> elements = parser.parse();
      setState(() {
        if (tabData[homeWidget.tabController.index]
                .title
                .contains("gopher://") &&
            !gotBack &&
            !getUp &&
            !tabData[homeWidget.tabController.index]
                .tabHistoryBottom
                .contains(tabData[homeWidget.tabController.index].title)) {
          tabData[homeWidget.tabController.index]
              .tabHistoryBottom
              .add(tabData[homeWidget.tabController.index].title);
        }
        if (gotBack &&
            !tabData[homeWidget.tabController.index]
                .tabHistoryTop
                .contains(searchUrl.toString())) {
          tabData[homeWidget.tabController.index].tabHistoryTop.clear();
        }
        tabData[homeWidget.tabController.index].title = searchUrl.toString();
        tabData[homeWidget.tabController.index].children = elements;
        if (!history.contains(searchUrl.toString())) {
          history.add(searchUrl.toString());
        }
      });
      _stopReloadAnimation();
    }).catchError((error) {
      setState(() {
        tabData[homeWidget.tabController.index].title = searchUrl.toString();
        tabData[homeWidget.tabController.index].children = [
          GopherElement(
              GopherController.ERROR_SELECTOR, error.toString(), "", "", 70)
        ];
      });

      _stopReloadAnimation();
    });

    getUp = false;
    gotBack = false;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: showAppBar
          ? AppBar(
              backgroundColor: Color(0xFF2E2E2E),
              automaticallyImplyLeading: true,
              leading: ReloadButton(
                isLoading: isLoading,
                currentUrl:
                    homeWidget.tabs[homeWidget.tabController.index].title,
                searchFunction: _searchGopher,
              ),
              title: RawKeyboardListener(
                focusNode: FocusNode(),
                onKey: _handleKeyEvent,
                child: TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: 'Search',
                    hintStyle: TextStyle(
                      fontFamily: 'Poppins',
                      color: Color(0xFF454545),
                    ),
                    enabledBorder: UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: Color(0xFFE8E8E8),
                        width: 1,
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    focusedBorder: UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: Color(0xFF5C5C5C),
                        width: 1,
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    errorBorder: UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: Color(0xFFFF7F7F),
                        width: 1,
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    focusedErrorBorder: UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: Color(0xFFFF7F7F),
                        width: 1,
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    filled: true,
                    fillColor: Color(0xFFB9B9B9),
                    suffixIcon: Container(
                      width: 24,
                      height: 24,
                      child: Image.asset(
                        'assets/gopher.png',
                        color: Color(0xFF454545),
                      ),
                    ),
                  ),
                  style: TextStyle(
                    fontFamily: 'Poppins',
                    color: Color(0xFF2E2E2E),
                  ),
                ),
              ),
              actions: [
                IconButton(
                  color: Color(0xFFE8E8E8),
                  icon: Icon(Icons.arrow_back),
                  onPressed: tabData[homeWidget.tabController.index]
                          .tabHistoryBottom
                          .isNotEmpty
                      ? goBack
                      : null,
                ),
                IconButton(
                  color: Color(0xFFE8E8E8),
                  icon: Icon(Icons.arrow_forward),
                  onPressed: tabData[homeWidget.tabController.index]
                          .tabHistoryTop
                          .isNotEmpty
                      ? goForward
                      : null,
                )
              ],
              centerTitle: true,
              elevation: 4,
            )
          : null,
      body: TabBarView(
        controller: _tabController,
        children: [
          AnimatedSwitcher(
            duration: Duration(milliseconds: 500),
            child: isLoading
                ? Center(
                    child: CircularProgressIndicator(),
                  )
                : homeWidget,
          ),
          historyWidget,
          settingsWidget,
          downloadWidget,
        ],
      ),
      bottomNavigationBar: TabBar(
        controller: _tabController,
        unselectedLabelColor: Color(0xFFB9B9B9),
        labelColor: Color(0xFF2E2E2E),
        indicatorColor: Color(0xFF2E2E2E),
        tabs: [
          Tab(
            icon: Icon(Icons.home),
          ),
          Tab(
            icon: Icon(Icons.history),
          ),
          Tab(
            icon: Icon(Icons.settings),
          ),
          Tab(
            icon: Icon(Icons.download),
          ),
        ],
      ),
    );
  }
}
